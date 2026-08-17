# System Architecture — Physics-Informed Hybrid Digital Twin

## 1. High-Level Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              USER INTERFACE                                  │
│                                                                              │
│   React Dashboard  (Vite + Tailwind + Recharts)  — localhost:5173            │
│                                                                              │
│   ┌────────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │
│   │  Sensor Sliders│  │  RUL Graph   │  │ Status Cards │  │3D Stream    │  │
│   │  (s_3 s_7 s_11)│  │  (live plot) │  │ HEALTHY /    │  │Viewer       │  │
│   │  op conditions │  │  + dRUL rate │  │ WARNING /    │  │(JPEG frames)│  │
│   └───────┬────────┘  └──────▲───────┘  │ CRITICAL     │  └──────▲──────┘  │
│           │   WebSocket      │          └──────────────┘         │          │
└───────────┼──────────────────┼─────────────────────────────────── ┼──────────┘
            │ JSON messages    │ prediction + frame bytes           │
            ▼                  │                                    │
┌───────────────────────────────────────────────────────────────────────────────┐
│                          FASTAPI BACKEND  — localhost:8000                    │
│                                                                               │
│   ┌───────────────────────────────────────────────────────────────────────┐  │
│   │  WebSocket Handler  /ws                                               │  │
│   │                                                                       │  │
│   │   actions: update | get_engine_info | start_lifecycle_simulation      │  │
│   │            stop_simulation | set_camera_preset | rotate_camera        │  │
│   └────────────────────┬──────────────────────────┬───────────────────────┘  │
│                        │                          │                           │
│   ┌────────────────────▼──────────┐  ┌───────────▼──────────────────────┐   │
│   │  HybridMLPredictor            │  │  BlenderClient (TCP socket)       │   │
│   │                               │  │                                   │   │
│   │  ┌─────────────────────────┐  │  │  host: localhost:5555             │   │
│   │  │  RealisticEngine        │  │  │  protocol: length-prefixed JSON   │   │
│   │  │  Simulator              │  │  │  + raw JPEG response              │   │
│   │  │  (bathtub wear curve,   │  │  │                                   │   │
│   │  │   fault injection,      │  │  │  Commands sent:                   │   │
│   │  │   maintenance events)   │  │  │  • update_and_render              │   │
│   │  └────────────┬────────────┘  │  │  • camera (rotate / preset)       │   │
│   │               │               │  └───────────────────────────────────┘   │
│   │  ┌────────────▼────────────┐  │                                          │
│   │  │  Physics Feature Eng.   │  │                                          │
│   │  │  thermal_ratio          │  │                                          │
│   │  │  thermal_margin         │  │                                          │
│   │  │  nozzle_thermal_ratio   │  │                                          │
│   │  │  stress_intensity       │  │                                          │
│   │  │  deformation_index      │  │                                          │
│   │  │  fatigue_damage         │  │                                          │
│   │  └────────────┬────────────┘  │                                          │
│   │               │               │                                          │
│   │  ┌────────────▼────────────┐  │                                          │
│   │  │  CNN-BiLSTM Model       │  │                                          │
│   │  │  hybrid_model.keras     │  │                                          │
│   │  │  → RUL (cycles)         │  │                                          │
│   │  │  → dRUL (rate)          │  │                                          │
│   │  └─────────────────────────┘  │                                          │
│   └───────────────────────────────┘                                          │
└───────────────────────────────────────────────────────────────────────────────┘
                                    │ TCP  localhost:5555
                                    ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                    BLENDER SERVER  (blender_server.py)                        │
│                    Runs inside Blender — Eevee render engine                  │
│                                                                               │
│   BlenderServer (threading.Thread)                                            │
│   │                                                                           │
│   ├── Receive command JSON                                                    │
│   │      Temperature  → controller["Temperature"]  (°C, range 400–670)       │
│   │      Pressure     → controller["Pressure"]     (normalised 0–1)          │
│   │      RUL          → controller["RUL"]          (cycles 0–125)            │
│   │      vibration_intensity → turbopump location offset (sin wave)          │
│   │                                                                           │
│   ├── update_digital_twin()                                                   │
│   │      Sets custom properties on DigitalTwin_Controller object              │
│   │      Drivers on material nodes read these → glow color / emission        │
│   │      Turbopump_NoiseDriver offset → mesh vibration animation              │
│   │      frame_set() triggers full Blender depsgraph update                  │
│   │                                                                           │
│   ├── render_frame()                                                          │
│   │      bpy.ops.render.render(write_still=True)  — Eevee, 640×480, 16 samp  │
│   │      Reads JPEG from temp file → returns bytes                            │
│   │                                                                           │
│   └── Send JPEG bytes back → Backend → WebSocket → Dashboard StreamViewer    │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. ML Training Pipeline

```
NASA N-CMAPSS DS02-006.h5
         │
         │  h5py  (subsampled 1/10 → ~651K rows)
         ▼
┌─────────────────────────────────────────────────────┐
│  Raw columns                                        │
│  A_vars : unit_nr, cycle, flight_class, ...         │
│  W_vars : op_1, op_2, op_3  (operating conditions) │
│  X_s    : s_1 … s_14        (physical sensors)     │
│  Y      : RUL label         (clipped at 125)        │
└──────────────────────────┬──────────────────────────┘
                           │
                           ▼
            Physics Feature Engineering
            ┌───────────────────────────────────────┐
            │  ANSYS constants baked in:            │
            │  chamber_temp_max  = 627.0 °C         │
            │  nozzle_temp_max   = 475.0 °C         │
            │  stress_max_mpa    = 3543.9 MPa       │
            │  deformation_max   = 0.189 mm         │
            │                                       │
            │  thermal_ratio         = s3_C / 627   │
            │  thermal_margin        = (627-s3_C)/627│
            │  nozzle_thermal_ratio  = s4_C / 475   │
            │  stress_intensity      = f(s_7 press.)│
            │  deformation_index     = f(s_7, s_3)  │
            │  fatigue_damage        = cumsum stress │
            └──────────────────┬────────────────────┘
                               │
            Rolling Features (window=5, key sensors only)
            s_2, s_3, s_4, s_7, s_11, s_12
            → *_ma5 (moving average), *_std5 (std dev)
                               │
                               ▼
            StandardScaler  (fit on dev split only)
                               │
                               ▼
            RULSequence  (Keras Sequence generator)
            window = 30 steps, stride = 5
            yields (X_batch [B, 30, F], y_batch [B, 2])
                 y[:,0] = RUL / 125  (normalised)
                 y[:,1] = dRUL approx (tanh output)
                               │
                               ▼
┌──────────────────────────────────────────────────────┐
│                  CNN-BiLSTM Model                    │
│                                                      │
│  Input  [batch, 30, n_features]                      │
│      │                                               │
│      ├──── CNN Branch ────────────────────────────── │
│      │     Conv1D(64, k=3, same) → BN → ReLU        │
│      │     Conv1D(64, k=3, same) → BN               │
│      │     MaxPool(2) → Dropout(0.2)                 │
│      │     Conv1D(128, k=3, same) → BN               │
│      │     MaxPool(2) → Dropout(0.2)                 │
│      │     GlobalAveragePooling1D  → [B, 128]        │
│      │                                               │
│      └──── BiLSTM Branch ─────────────────────────── │
│            BiLSTM(64, return_sequences=True)         │
│            Dropout(0.2)                              │
│            BiLSTM(32)  → [B, 64]                     │
│            Dropout(0.2)                              │
│                                                      │
│      Concatenate  → [B, 192]                         │
│      Dense(128, relu) → BN → Dropout(0.3)            │
│      Dense(64,  relu) → Dropout(0.2)                 │
│                                                      │
│      ┌─────────────────┐  ┌─────────────────────┐   │
│      │ rul  (linear)   │  │ drul (tanh)          │   │
│      └────────┬────────┘  └──────────┬──────────┘   │
│               └──────────┬───────────┘               │
│                    output [B, 2]                      │
│                                                      │
│  Loss: MSE   Optimizer: Adam(1e-3)                   │
│  Callbacks: EarlyStopping(patience=8)                │
│             ReduceLROnPlateau(patience=4)             │
│             ModelCheckpoint (val_loss)               │
└──────────────────────────────────────────────────────┘
                               │
                               ▼
              model_artifacts/
              ├── hybrid_model.keras      MAE 5.70 / RMSE 6.27
              ├── hybrid_scaler.save
              ├── hybrid_features.json
              ├── hybrid_metrics.json
              ├── baseline_model.keras    MAE 6.14 / RMSE 7.31
              └── ansys_physics.json
```

---

## 3. Data Flow at Inference (Runtime)

```
  ┌──────────────────────────────────────────────────────────────────┐
  │  Engine selection                                                │
  │                                                                  │
  │  engine_id == 0   → Custom engine (RealisticEngineSimulator)     │
  │                      bathtub wear curve + fault injection        │
  │                      sensor values generated procedurally        │
  │                                                                  │
  │  engine_id 1–248  → Real N-CMAPSS engine (C-MAPSS FD004 subset)  │
  │                      actual sensor readings from test set        │
  │                      predict_with_model() → CNN-BiLSTM           │
  └──────────────────────────────────────────────────────────────────┘
           │                              │
           ▼                              ▼
  simulate_degradation()        get_sensors_at_cycle()
  (procedural wear)             (lookup from DataFrame)
           │                              │
           └──────────────┬───────────────┘
                          ▼
             _calculate_physics_features()
             (same ANSYS constants as training)
                          │
                          ▼
             predict()  →  { rul, drul, status,
                             temperature, pressure, vibration,
                             stress_mpa, deformation_mm,
                             physics_degradation, thermal_margin }
                          │
             ┌────────────┴────────────────┐
             │                             │
             ▼                             ▼
     WebSocket JSON msg            blender_client.update_and_render()
     → React dashboard             → Blender TCP socket
                                   → render_frame() JPEG
                                   → WebSocket bytes
                                   → StreamViewer component
```

---

## 4. ANSYS FEA Integration

The ANSYS simulations were run once (offline) on the two main engine components:

```
combustion chamber.stl  ──►  ANSYS Mechanical (static structural + thermal)
                              Results exported to:
                              temp_combustionchamber.txt  → 626.73 – 627.0 °C
                              stress.txt                  → 54.195 – 3543.9 MPa
                              deformation.txt             → 0.0 – 0.18929 mm

nozzle.stl              ──►  ANSYS Mechanical (thermal)
                              Results exported to:
                              temp_nozzle.txt             → 474.45 – 475.0 °C
```

These six scalar bounds (min/mean/max for each quantity) become the physical reference frame for every feature the ML model sees. A sensor reading of s_3 = 1650 °R translates to ~627 °C — exactly at the ANSYS combustion chamber thermal limit — giving `thermal_margin = 0` and `thermal_ratio = 1.0`, which are the highest-degradation values those features can take.

This coupling means the model has physically calibrated inputs rather than arbitrary normalised sensor numbers.
