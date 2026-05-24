"""
================================================================================
HYBRID DIGITAL TWIN - OPTIMIZED TRAINING SCRIPT
================================================================================
Optimized for 24GB RAM laptop (no GPU required)
Key optimizations:
  1. Subsampling factor 10 at load time  → 6.5M rows become 651K
  2. Keras Sequence generator            → sequences never fully materialized
  3. Dev/test kept separate              → proper benchmark split
  4. float32 throughout                  → half the memory of float64

Run: python hybrid_model_local.py
================================================================================
"""

import numpy as np
import pandas as pd
import os
import json
import time
import gc

os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'

import tensorflow as tf
from tensorflow.keras.models import Model
from tensorflow.keras.layers import (
    Input, Conv1D, MaxPooling1D, LSTM, Bidirectional,
    Dense, Dropout, BatchNormalization, Concatenate, GlobalAveragePooling1D
)
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau, ModelCheckpoint
from tensorflow.keras.utils import Sequence
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_squared_error, mean_absolute_error
import joblib
import h5py

# ============================================================================
# CONFIGURATION
# ============================================================================

PROJECT_DIR   = r"D:\EL\RUL-prediction-for-aircraft-subsystems"
DATA_DIR      = os.path.join(PROJECT_DIR, "nmapss")
MODEL_DIR     = os.path.join(PROJECT_DIR, "model_artifacts")
os.makedirs(MODEL_DIR, exist_ok=True)

# ── memory knobs ──────────────────────────────────────────────────────────────
SUBSAMPLE     = 10      # keep every Nth row  (10 → ~651K rows, ~2 GB df)
SEQ_LEN       = 30      # window length        (30 instead of 50 → 64% less memory)
STRIDE        = 5       # step between windows (5 → 5× fewer sequences)
# ─────────────────────────────────────────────────────────────────────────────

RUL_CLIP      = 125
EPOCHS        = 50
BATCH_SIZE    = 512     # larger batch → fewer Python iterations on CPU
VALIDATION_SPLIT = 0.2

# ============================================================================
# ANSYS PHYSICS CONSTANTS
# ============================================================================

ANSYS_PHYSICS = {
    'chamber_temp_min':    626.73,
    'chamber_temp_max':    627.0,
    'chamber_temp_mean':   626.86,
    'nozzle_temp_min':     474.45,
    'nozzle_temp_max':     475.0,
    'nozzle_temp_mean':    474.7,
    'stress_min_mpa':      54.195,
    'stress_max_mpa':      3543.9,
    'stress_mean_mpa':     861.31,
    'deformation_min_mm':  0.0,
    'deformation_max_mm':  0.18929,
    'deformation_mean_mm': 0.09596,
}

# ============================================================================
# HELPERS
# ============================================================================

def print_header(text):
    print("\n" + "="*70)
    print(f"  {text}")
    print("="*70)

def mem_usage(df):
    mb = df.memory_usage(deep=True).sum() / 1024**2
    return f"{mb:.1f} MB"

# ============================================================================
# DATA LOADING  (subsampled)
# ============================================================================

def load_data():
    print_header("LOADING N-CMAPSS DS02  (subsample=1/{})".format(SUBSAMPLE))

    h5_path = os.path.join(DATA_DIR, 'N-CMAPSS_DS02-006.h5')
    if not os.path.exists(h5_path):
        raise FileNotFoundError(f"File not found: {h5_path}")

    print(f"  Source : {h5_path}")

    with h5py.File(h5_path, 'r') as hdf:
        def decode_var(key):
            raw = hdf[key][()]
            return [v.decode('utf-8') if isinstance(v, bytes) else str(v) for v in raw]

        W_var   = decode_var('W_var')
        X_s_var = decode_var('X_s_var')
        X_v_var = decode_var('X_v_var')
        A_var   = decode_var('A_var')
        def load_split(tag):
            """Load one split (dev/test) with subsampling applied."""
            sl = slice(None, None, SUBSAMPLE)
            W   = hdf[f'W_{tag}'][sl].astype(np.float32)
            X_s = hdf[f'X_s_{tag}'][sl].astype(np.float32)
            X_v = hdf[f'X_v_{tag}'][sl].astype(np.float32)
            Y   = hdf[f'Y_{tag}'][sl].astype(np.float32)
            A   = hdf[f'A_{tag}'][sl].astype(np.float32)
            return W, X_s, X_v, Y, A

        W_dev,   X_s_dev,   X_v_dev,   Y_dev,   A_dev   = load_split('dev')
        W_test,  X_s_test,  X_v_test,  Y_test,  A_test  = load_split('test')

    def build_df(W, X_s, X_v, Y, A, split_label):
        df = pd.DataFrame(A, columns=A_var, dtype=np.float32)
        df.rename(columns={'unit': 'unit_nr', 'cycle': 'time_cycles'}, inplace=True)

        # operative conditions
        for k, name in enumerate(['op_1', 'op_2', 'op_3']):
            df[name] = W[:, k]

        # physical sensors (X_s only — drop X_v to save memory)
        for k in range(X_s.shape[1]):
            df[f's_{k+1}'] = X_s[:, k]

        df['RUL']   = np.clip(Y[:, 0], 0, RUL_CLIP)
        df['split'] = split_label
        return df

    df_dev  = build_df(W_dev,  X_s_dev,  X_v_dev,  Y_dev,  A_dev,  'dev')
    df_test = build_df(W_test, X_s_test, X_v_test, Y_test, A_test, 'test')

    print(f"  Dev  rows : {len(df_dev):,}  engines: {df_dev['unit_nr'].nunique()}"
          f"  RAM: {mem_usage(df_dev)}")
    print(f"  Test rows : {len(df_test):,}  engines: {df_test['unit_nr'].nunique()}"
          f"  RAM: {mem_usage(df_test)}")

    # free raw arrays immediately
    del W_dev, X_s_dev, X_v_dev, Y_dev, A_dev
    del W_test, X_s_test, X_v_test, Y_test, A_test
    gc.collect()

    return df_dev, df_test

# ============================================================================
# PHYSICS FEATURE ENGINEERING
# ============================================================================

def add_physics_features(df):
    print_header("PHYSICS FEATURE ENGINEERING")

    # ── Thermal ───────────────────────────────────────────────────────────────
    if 's_3' in df.columns:                                   # T30 – HPC outlet (Rankine)
        s3_c = (df['s_3'] - 459.67) * 5/9
        df['thermal_ratio']  = (s3_c / ANSYS_PHYSICS['chamber_temp_max']).astype(np.float32)
        df['thermal_margin'] = ((ANSYS_PHYSICS['chamber_temp_max'] - s3_c)
                                / ANSYS_PHYSICS['chamber_temp_max']).clip(lower=0).astype(np.float32)

    if 's_4' in df.columns:                                   # T48 – LPT outlet (Rankine)
        s4_c = (df['s_4'] - 459.67) * 5/9
        df['nozzle_thermal_ratio'] = (s4_c / ANSYS_PHYSICS['nozzle_temp_max']).astype(np.float32)

    # ── Stress ────────────────────────────────────────────────────────────────
    if 's_7' in df.columns:                                   # P30 – HPC outlet pressure
        p_min, p_max = df['s_7'].min(), df['s_7'].max()
        p_norm = (df['s_7'] - p_min) / (p_max - p_min + 1e-6)
        stress_range = ANSYS_PHYSICS['stress_max_mpa'] - ANSYS_PHYSICS['stress_min_mpa']
        df['stress_intensity'] = (ANSYS_PHYSICS['stress_min_mpa'] + p_norm * stress_range) \
                                  / ANSYS_PHYSICS['stress_max_mpa']
        df['stress_intensity'] = df['stress_intensity'].astype(np.float32)

    # ── Deformation ───────────────────────────────────────────────────────────
    if 's_7' in df.columns and 's_3' in df.columns:
        p_norm = (df['s_7'] - df['s_7'].min()) / (df['s_7'].max() - df['s_7'].min() + 1e-6)
        t_norm = (df['s_3'] - df['s_3'].min()) / (df['s_3'].max() - df['s_3'].min() + 1e-6)
        df['deformation_index'] = ((0.6*p_norm + 0.4*t_norm)
                                   * ANSYS_PHYSICS['deformation_max_mm']
                                   / ANSYS_PHYSICS['deformation_max_mm']).astype(np.float32)

    # ── Fatigue (cumulative stress per engine) ────────────────────────────────
    if 'stress_intensity' in df.columns:
        cumsum = df.groupby('unit_nr')['stress_intensity'].cumsum()
        group_max = df.groupby('unit_nr')['stress_intensity'].transform('sum')
        df['fatigue_damage'] = (cumsum / (group_max + 1e-6)).astype(np.float32)

    physics_added = [c for c in
                     ['thermal_ratio','thermal_margin','nozzle_thermal_ratio',
                      'stress_intensity','deformation_index','fatigue_damage']
                     if c in df.columns]
    print(f"  Added {len(physics_added)} physics features: {physics_added}")
    return df

# ============================================================================
# ROLLING FEATURES  (only on key sensors to save RAM)
# ============================================================================

def add_rolling_features(df):
    print_header("ROLLING FEATURES  (window=5)")
    key = ['s_2','s_3','s_4','s_7','s_11','s_12']   # reduced set
    for s in key:
        if s not in df.columns:
            continue
        grp = df.groupby('unit_nr')[s]
        df[f'{s}_ma5']  = grp.transform(lambda x: x.rolling(5, min_periods=1).mean()).astype(np.float32)
        df[f'{s}_std5'] = grp.transform(lambda x: x.rolling(5, min_periods=1).std().fillna(0)).astype(np.float32)
        print(f"    ✓ {s}_ma5 / {s}_std5")
    return df

# ============================================================================
# KERAS SEQUENCE GENERATOR  (never materializes the full array)
# ============================================================================

class RULSequence(Sequence):
    """
    Yields (X_batch, y_batch) without storing all sequences in RAM.
    Indices are pre-built (lightweight list of (engine_idx, start_row)),
    then data is sliced on-the-fly from the scaled numpy arrays stored
    per-engine.
    """

    def __init__(self, engine_arrays, seq_len, stride, batch_size, shuffle=True):
        """
        engine_arrays : list of (features_array, rul_array) per engine
        """
        self.ea         = engine_arrays
        self.seq_len    = seq_len
        self.stride     = stride
        self.batch_size = batch_size
        self.shuffle    = shuffle

        # build index: list of (engine_id, start_idx)
        self.index = []
        for eid, (feat, rul) in enumerate(engine_arrays):
            n = len(feat)
            for start in range(0, n - seq_len + 1, stride):
                self.index.append((eid, start))

        self.index = np.array(self.index, dtype=np.int32)
        if shuffle:
            np.random.shuffle(self.index)

        print(f"    Generator: {len(self.index):,} windows  "
              f"batch_size={batch_size}  "
              f"steps={len(self):,}")

    def __len__(self):
        return int(np.ceil(len(self.index) / self.batch_size))

    def __getitem__(self, batch_idx):
        batch_ids = self.index[batch_idx*self.batch_size :
                               (batch_idx+1)*self.batch_size]
        X_list, y_list = [], []
        for eid, start in batch_ids:
            feat, rul = self.ea[eid]
            X_list.append(feat[start : start + self.seq_len])
            y_list.append(rul[start + self.seq_len - 1])

        X = np.stack(X_list).astype(np.float32)
        y = np.array(y_list, dtype=np.float32)

        # targets: normalised RUL + dRUL (approx as 0 for generator simplicity)
        y_norm = y / RUL_CLIP
        y_drul = np.zeros_like(y_norm)
        return X, np.column_stack([y_norm, y_drul])

    def on_epoch_end(self):
        if self.shuffle:
            np.random.shuffle(self.index)


def build_engine_arrays(df, feature_cols, scaler=None, fit_scaler=False):
    """
    Returns (engine_arrays, scaler).
    engine_arrays = list of (scaled_features, rul) per engine, sorted by cycle.
    """
    engines = sorted(df['unit_nr'].unique())
    all_feat = df[feature_cols].values.astype(np.float32)

    if fit_scaler:
        scaler = StandardScaler()
        scaler.fit(all_feat)

    ea = []
    for eng in engines:
        mask = df['unit_nr'] == eng
        edf  = df[mask].sort_values('time_cycles')
        feat = scaler.transform(edf[feature_cols].values.astype(np.float32))
        rul  = edf['RUL'].values.astype(np.float32)
        ea.append((feat, rul))

    return ea, scaler

# ============================================================================
# MODEL
# ============================================================================

def build_model(n_features):
    inputs = Input(shape=(SEQ_LEN, n_features), name='input')

    # CNN branch
    x = Conv1D(64, 3, activation='relu', padding='same')(inputs)
    x = BatchNormalization()(x)
    x = Conv1D(64, 3, activation='relu', padding='same')(x)
    x = MaxPooling1D(2)(x)
    x = Dropout(0.2)(x)
    x = Conv1D(128, 3, activation='relu', padding='same')(x)
    x = BatchNormalization()(x)
    x = MaxPooling1D(2)(x)
    x = Dropout(0.2)(x)
    cnn_out = GlobalAveragePooling1D()(x)

    # BiLSTM branch
    y = Bidirectional(LSTM(64, return_sequences=True))(inputs)
    y = Dropout(0.2)(y)
    lstm_out = Bidirectional(LSTM(32))(y)
    lstm_out = Dropout(0.2)(lstm_out)

    combined = Concatenate()([cnn_out, lstm_out])
    z = Dense(128, activation='relu')(combined)
    z = BatchNormalization()(z)
    z = Dropout(0.3)(z)
    z = Dense(64, activation='relu')(z)
    z = Dropout(0.2)(z)

    rul_out  = Dense(1, activation='linear', name='rul')(z)
    drul_out = Dense(1, activation='tanh',   name='drul')(z)
    out      = Concatenate(name='output')([rul_out, drul_out])

    model = Model(inputs, out)
    model.compile(optimizer=tf.keras.optimizers.Adam(1e-3),
                  loss='mse', metrics=['mae'])
    return model

# ============================================================================
# TRAIN ONE MODEL
# ============================================================================

def train_model(df_train, df_val_engines, feature_cols, model_name):
    print_header(f"TRAINING  {model_name.upper()}")
    t0 = time.time()

    n_feat = len(feature_cols)
    print(f"  Features : {n_feat}")

    # build per-engine arrays for train split
    print("  Fitting scaler on training data...")
    train_ea, scaler = build_engine_arrays(df_train, feature_cols, fit_scaler=True)

    # split train engines into train / val  (last 20% of engines → val)
    n_val   = max(1, int(len(train_ea) * VALIDATION_SPLIT))
    val_ea  = train_ea[-n_val:]
    tr_ea   = train_ea[:-n_val]

    train_gen = RULSequence(tr_ea,  SEQ_LEN, STRIDE, BATCH_SIZE, shuffle=True)
    val_gen   = RULSequence(val_ea, SEQ_LEN, STRIDE, BATCH_SIZE, shuffle=False)

    model = build_model(n_feat)
    print(f"  Parameters: {model.count_params():,}")

    callbacks = [
        EarlyStopping(monitor='val_loss', patience=8,
                      restore_best_weights=True, verbose=1),
        ReduceLROnPlateau(monitor='val_loss', factor=0.5,
                          patience=4, min_lr=1e-6, verbose=1),
        ModelCheckpoint(os.path.join(MODEL_DIR, f'{model_name}_best.keras'),
                        monitor='val_loss', save_best_only=True, verbose=0),
    ]

    history = model.fit(
        train_gen,
        validation_data=val_gen,
        epochs=EPOCHS,
        callbacks=callbacks,
        verbose=1,
    )

    # ── evaluate on held-out test engines ────────────────────────────────────
    print("\n  Evaluating on test engines...")
    test_ea, _ = build_engine_arrays(df_val_engines, feature_cols, scaler=scaler)

    y_true_all, y_pred_all = [], []
    for feat, rul in test_ea:
        # slide window with stride 1 for evaluation
        n = len(feat)
        if n < SEQ_LEN:
            continue
        X_e = np.stack([feat[i:i+SEQ_LEN] for i in range(0, n-SEQ_LEN+1, 1)])
        preds = model.predict(X_e, batch_size=BATCH_SIZE, verbose=0)
        y_pred_all.append(preds[:, 0] * RUL_CLIP)
        y_true_all.append(rul[SEQ_LEN-1:])

    y_true = np.concatenate(y_true_all)
    y_pred = np.concatenate(y_pred_all)

    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    mae  = float(mean_absolute_error(y_true, y_pred))
    elapsed = time.time() - t0

    print(f"\n  ┌─────────────────────────────┐")
    print(f"  │  {model_name.upper():<10}  RMSE: {rmse:6.2f}  MAE: {mae:6.2f}  │")
    print(f"  │  Time: {elapsed/60:.1f} min               │")
    print(f"  └─────────────────────────────┘")

    # save
    model.save(os.path.join(MODEL_DIR, f'{model_name}_model.keras'))
    joblib.dump(scaler, os.path.join(MODEL_DIR, f'{model_name}_scaler.save'))
    with open(os.path.join(MODEL_DIR, f'{model_name}_features.json'), 'w') as f:
        json.dump(feature_cols, f, indent=2)
    with open(os.path.join(MODEL_DIR, f'{model_name}_metrics.json'), 'w') as f:
        json.dump({'rmse': rmse, 'mae': mae,
                   'epochs': len(history.history['loss']),
                   'time_min': elapsed/60}, f, indent=2)

    return model, scaler, {'rmse': rmse, 'mae': mae, 'time_min': elapsed/60}

# ============================================================================
# MAIN
# ============================================================================

def main():
    print("\n╔" + "═"*68 + "╗")
    print("║  🚀 HYBRID DIGITAL TWIN — OPTIMISED FOR 24 GB RAM" + " "*18 + "║")
    print("║  Physics-Informed CNN-BiLSTM on N-CMAPSS DS02" + " "*22 + "║")
    print("╚" + "═"*68 + "╝")

    t_total = time.time()

    # GPU check
    print_header("SYSTEM CHECK")
    gpus = tf.config.list_physical_devices('GPU')
    if gpus:
        print(f"  ✓ GPU : {gpus[0].name}")
    else:
        print("  ℹ  CPU mode — estimated training time: 30-50 min per model")
    print(f"  SEQ_LEN={SEQ_LEN}  STRIDE={STRIDE}  SUBSAMPLE=1/{SUBSAMPLE}")

    # ── load ─────────────────────────────────────────────────────────────────
    df_dev, df_test = load_data()

    # ── feature engineering (on dev only; test uses same scaler) ─────────────
    print_header("FEATURE ENGINEERING")
    for label, df in [('dev', df_dev), ('test', df_test)]:
        df_dev  = add_physics_features(df_dev)  if label == 'dev'  else df_dev
        df_test = add_physics_features(df_test) if label == 'test' else df_test
    df_dev  = add_rolling_features(df_dev)
    df_test = add_rolling_features(df_test)
    df_dev.fillna(0, inplace=True)
    df_test.fillna(0, inplace=True)

    # ── feature column lists ──────────────────────────────────────────────────
    print_header("FEATURE SETS")
    sensor_cols  = [f's_{i}'   for i in range(1, 15)]          # X_s only (14)
    op_cols      = ['op_1','op_2','op_3']
    rolling_cols = [c for c in df_dev.columns if c.endswith(('_ma5','_std5'))]
    physics_cols = [c for c in ['thermal_ratio','thermal_margin',
                                'nozzle_thermal_ratio','stress_intensity',
                                'deformation_index','fatigue_damage']
                    if c in df_dev.columns]

    baseline_features = [c for c in sensor_cols + op_cols + rolling_cols
                         if c in df_dev.columns]
    hybrid_features   = baseline_features + physics_cols

    print(f"  Baseline : {len(baseline_features)} features")
    print(f"  Physics  : {len(physics_cols)} features  {physics_cols}")
    print(f"  Hybrid   : {len(hybrid_features)} features")

    # estimated memory for a full array (informational only — we don't build it)
    n_windows = sum(max(0, len(df_dev[df_dev.unit_nr==e]) - SEQ_LEN + 1)
                    for e in df_dev.unit_nr.unique())
    est_gb = n_windows * SEQ_LEN * len(hybrid_features) * 4 / 1024**3
    print(f"\n  ℹ  Full array would be ~{est_gb:.1f} GB → using generator instead ✓")

    # ── train ─────────────────────────────────────────────────────────────────
    baseline_model, baseline_scaler, bm = train_model(
        df_dev, df_test, baseline_features, 'baseline')

    # free model weights from GPU/CPU before training hybrid
    tf.keras.backend.clear_session()
    gc.collect()

    hybrid_model, hybrid_scaler, hm = train_model(
        df_dev, df_test, hybrid_features, 'hybrid')

    # save ANSYS constants for backend use
    with open(os.path.join(MODEL_DIR, 'ansys_physics.json'), 'w') as f:
        json.dump(ANSYS_PHYSICS, f, indent=2)

    # ── summary ───────────────────────────────────────────────────────────────
    print_header("FINAL COMPARISON")
    print(f"\n  {'Model':<12} {'RMSE':>8} {'MAE':>8} {'Time':>10}")
    print(f"  {'-'*42}")
    print(f"  {'Baseline':<12} {bm['rmse']:>8.2f} {bm['mae']:>8.2f} {bm['time_min']:>8.1f} min")
    print(f"  {'Hybrid':<12} {hm['rmse']:>8.2f} {hm['mae']:>8.2f} {hm['time_min']:>8.1f} min")

    delta = bm['rmse'] - hm['rmse']
    pct   = delta / bm['rmse'] * 100
    print(f"\n  {'✅ Hybrid wins!' if delta > 0 else '⚠ Similar performance'}")
    if delta > 0:
        print(f"  RMSE improvement: {delta:.2f} cycles  ({pct:.1f}%)")

    print(f"\n  Total time : {(time.time()-t_total)/60:.1f} min")
    print(f"  Saved to   : {MODEL_DIR}")
    print(f"\n  Files:")
    for f in ['hybrid_model.keras','hybrid_scaler.save','hybrid_features.json',
              'baseline_model.keras','ansys_physics.json']:
        print(f"    • {f}")

if __name__ == "__main__":
    main()