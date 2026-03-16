# rubric_ai_detector

Lightweight ML utilities for an auto-grading capstone project.

This package is designed for limited infrastructure: CPU only, small memory footprint, fast startup, and reasonable behavior under deadline spikes. It uses engineered source-code features plus a small MLP instead of a large language model, so it is much cheaper to run in production.

## What It Can Do

This starter package supports three advisory pipelines:

1. `ai_detect`
   Binary classifier that estimates whether a submission's style looks AI-generated.
2. `rubric`
   Multi-output regressor that predicts rubric criterion scores from historical grading data.
3. `plagiarism`
   Pairwise similarity scan that flags suspiciously similar submissions.

These outputs should be treated as review signals for instructors, not proof and not automatic punishment.

## Supported Languages

The feature extractor now supports:

- Python: `.py`
- Java: `.java`
- Perl: `.pl`, `.pm`
- JavaScript: `.js`, `.mjs`, `.cjs`, `.jsx`
- CSS: `.css`
- HTML: `.html`, `.htm`

The pipeline stays lightweight by using:

- formatting and whitespace statistics
- comment density and style
- token frequency and repetition
- identifier variety and entropy
- structural markers like braces, blocks, imports, functions, classes, selectors, and tags
- Python-only AST and cyclomatic complexity features when the file is Python
- one-hot language flags so one model can be trained on mixed-language datasets

## How It Works

### 1. Dataset prep

`python -m ai.prepare_dataset` reads `ai/data/labels.csv`, finds the matching source files, extracts a fixed set of numeric features, creates train/validation/test splits, standardizes the features, and writes `.npy` artifacts.

### 2. Training

`python -m ai.train` trains a very small feed-forward MLP on those features:

- `ai_detect` uses binary classification with `BCEWithLogitsLoss`
- `rubric` uses regression with `SmoothL1Loss`

### 3. Evaluation

`python -m ai.evaluate` reports:

- AI detector: ROC-AUC, confusion matrix, precision, recall, F1
- Rubric model: overall MAE and MAE per rubric criterion

### 4. Inference

`python -m ai.infer` loads the scaler and checkpoint, extracts features from one file, and returns either:

- AI-generated probability
- predicted rubric scores by criterion name

## Why This Is Lightweight

This is intentionally not an LLM-based grader or detector.

Benefits:

- CPU friendly
- fast inference
- no GPU required
- easy to retrain
- cheaper to operate during high-load submission windows
- easier to deploy alongside the rest of the app

Tradeoff:

- accuracy is limited by feature quality and training data quality
- detection is stylistic and probabilistic, not semantic proof

## Setup

### 1. Create a virtual environment

#### Windows PowerShell

```powershell
cd rubric_ai_detector
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
```

#### macOS / Linux

```bash
cd rubric_ai_detector
python3 -m venv .venv
source .venv/bin/activate
```

### 2. Install dependencies

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

### 3. Add source files

Put submissions into:

- human-authored: `ai/data/raw/human/`
- AI-authored: `ai/data/raw/ai/`

You can mix supported languages in those folders.

Examples:

```text
ai/data/raw/human/
  student_001.py
  student_002.java
  student_003.js
  student_004.html

ai/data/raw/ai/
  ai_001.py
  ai_002.java
  ai_003.css
```

You can also organize them into language subfolders if you want:

```text
ai/data/raw/human/python/student_001.py
ai/data/raw/human/java/student_002.java
ai/data/raw/ai/javascript/ai_003.js
```

### 4. Create `labels.csv`

Required columns:

- `sample_id`
- `source` (`human` or `ai`)
- `label_ai` (`0` for human, `1` for AI)

Optional columns:

- `language`
  Recommended when `sample_id` does not uniquely identify the file extension.
- `filename`
  Useful if the file name does not exactly match `sample_id`.
- rubric columns
  Any numeric rubric target columns you want the regression model to predict.

Example:

```csv
sample_id,source,label_ai,language,filename,readability_points,design_points,docs_points
human_py_001,human,0,python,human_py_001.py,4.5,4.0,3.5
human_java_001,human,0,java,human_java_001.java,4.0,4.0,3.0
ai_js_001,ai,1,javascript,ai_js_001.js,2.5,2.0,1.5
human_html_001,human,0,html,human_html_001.html,4.0,3.5,4.5
```

## Preparing the Dataset

### Mixed-language dataset

```bash
python -m ai.prepare_dataset --language all
```

### One-language dataset

```bash
python -m ai.prepare_dataset --language java
```

### Custom rubric columns

If you want rubric regression to predict your own criteria instead of the starter `readability_points`, `design_points`, and `docs_points`, pass them explicitly:

```bash
python -m ai.prepare_dataset --language all --rubric_columns correctness_points,style_points,testing_points
```

Outputs:

- `ai/data/features/X_train.npy`, `X_val.npy`, `X_test.npy`
- `ai/data/features/y_ai_train.npy`, `y_ai_val.npy`, `y_ai_test.npy`
- `ai/data/features/Y_rubric_train.npy`, `Y_rubric_val.npy`, `Y_rubric_test.npy` if rubric columns exist
- `ai/data/features/scaler.joblib`
- `ai/data/features/feature_names.json`
- `ai/data/features/rubric_column_names.json` if rubric columns exist
- metadata CSVs in `ai/data/splits/`

## Training

### Train the AI detector

```bash
python -m ai.train --task ai_detect --epochs 100 --batch_size 16 --lr 1e-3 --weight_decay 1e-4 --patience 10
```

Saved checkpoint:

- `ai/output/best_ai_detect.pth`

### Train the rubric model

```bash
python -m ai.train --task rubric --epochs 100 --batch_size 16 --lr 1e-3 --weight_decay 1e-4 --patience 10
```

Saved checkpoint:

- `ai/output/best_rubric.pth`

## Evaluation

### AI detector evaluation

```bash
python -m ai.evaluate --task ai_detect --threshold 0.85
```

Saved report:

- `ai/output/evaluation_ai_detect.json`

### Rubric evaluation

```bash
python -m ai.evaluate --task rubric
```

Saved report:

- `ai/output/evaluation_rubric.json`

## Inference

### AI detector

```bash
python -m ai.infer --task ai_detect --file ai/data/raw/human/human_java_001.java --threshold 0.85
```

Output fields:

- `file`
- `language`
- `ai_generated_probability`
- `flagged`
- `threshold`

### Rubric prediction

```bash
python -m ai.infer --task rubric --file ai/data/raw/human/human_html_001.html
```

Output fields:

- `file`
- `language`
- `predicted_rubric_scores`

`predicted_rubric_scores` is a dictionary keyed by rubric column name when `rubric_column_names.json` is present.

## Plagiarism Comparison

Compare all supported source files in one folder:

```bash
python -m ai.plagiarism --folder submissions_folder --mode global --top_k 20 --threshold 0.85 --output ai/output/plagiarism_report.json --csv_output ai/output/plagiarism_report.csv
```

Assignment-organized folders:

```text
submissions_root/
  assignment_1/
    student_a.py
    student_b.py
    student_c.java
  assignment_2/
    student_d.js
    student_e.js
    student_f.html
```

Run:

```bash
python -m ai.plagiarism --folder submissions_root --mode assignment --top_k 20 --threshold 0.85
```

Notes:

- comparison is only done within the same assignment group
- files are also grouped by language so Java is not compared against HTML
- assignment mode strips an exact common token prefix to reduce noise from shared starter code

Signals combined into the final similarity score:

- normalized text similarity
- token sequence similarity
- token Jaccard similarity
- structural sequence similarity

## Recommended Training Strategy

Because this is a lightweight model, the training data strategy matters more than model complexity.

### For AI detection

Recommended:

- train separate models per language when you have enough data
- otherwise train one mixed-language model using the built-in language features
- keep class balance reasonably close between human and AI samples
- use submissions from the same types of assignments you will grade in production
- retrain occasionally as AI coding style changes

### For rubric prediction

Recommended:

- train per course, per assignment family, or per rubric version when criteria differ a lot
- use only historically human-scored submissions
- keep rubric criteria consistent across the training set
- normalize grading practices first if multiple instructors graded differently
- use the model as a draft scorer, not as the final authority

## How To Train a Model To Grade Off a Rubric

The current code now supports arbitrary rubric target columns, but you still need stable training data.

### Option A: Canonical rubric dimensions across many assignments

Example targets:

- `readability_points`
- `design_points`
- `docs_points`
- `testing_points`

This is easiest if your program uses a shared grading philosophy across assignments.

### Option B: One model per assignment or rubric version

If Assignment 3 has criteria like:

- `correctness_points`
- `efficiency_points`
- `style_points`

then export historical submissions for that assignment, prepare the dataset with:

```bash
python -m ai.prepare_dataset --language java --rubric_columns correctness_points,efficiency_points,style_points
```

Then train:

```bash
python -m ai.train --task rubric
```

This is usually the better approach when rubric criteria change substantially between assignments.

### Where the labels come from in your app

In this repository, rubric grading data lives in the backend models:

- `RubricVersion`
- `RubricCriterion`
- `RubricScore`
- `GradingRun`

To build training data:

1. Export each historical submission and its final human-awarded rubric criterion scores.
2. Flatten each submission to one row in `labels.csv`.
3. Create one numeric column per rubric criterion you want to predict.
4. Copy the original submission file into `ai/data/raw/human/` or another training directory.
5. Run `ai.prepare_dataset` with the rubric columns you exported.

Important:

- only train on finalized human-reviewed grades
- avoid mixing different rubric versions unless the criterion columns mean the same thing
- if criteria weights change, store raw awarded points or normalized percentages consistently

## How To Implement This In the App

This repo already has the right building blocks to integrate a lightweight AI review step.

Relevant backend pieces:

- grading worker: `backend/autograder/grader/runner.py`
- rubric models: `backend/autograder/models/grading.py`
- rubric services: `backend/autograder/services/rubric_service.py`

Recommended implementation:

### 1. Train offline, not during request handling

Keep training as a manual or scheduled admin task. Do not train inside the web app.

Artifacts to publish:

- model checkpoint: `best_ai_detect.pth` or `best_rubric.pth`
- scaler: `scaler.joblib`
- feature metadata: `feature_names.json`
- rubric metadata: `rubric_column_names.json` if using rubric prediction

### 2. Add a lightweight inference service in the backend

Suggested new module:

- `backend/autograder/services/ai_review_service.py`

That service should:

- locate the extracted submission file
- infer the language from file extension
- load the model and scaler once per worker process
- run `extract_features_from_file(...)`
- return a small JSON payload

Example payload:

```json
{
  "ai_detect": {
    "language": "java",
    "ai_generated_probability": 0.31,
    "flagged": false,
    "threshold": 0.85
  },
  "rubric_prediction": {
    "style_points": 4.2,
    "testing_points": 3.8
  }
}
```

### 3. Run inference asynchronously

Do not block the upload request or main grading request on AI review if you expect spikes near due dates.

Better pattern:

1. submission is uploaded
2. normal deterministic grading runs first
3. a background worker runs the AI review task
4. results are stored back on the grading run or a dedicated table

### 4. Store results as advisory metadata

Good first implementation:

- store the AI review payload in `GradingRun.result_json`

Better long-term implementation:

- add a dedicated `AIReviewResult` model keyed to `Submission` or `GradingRun`

### 5. Show results only to instructors

Recommended UI behavior:

- show AI probability as a flag, not a verdict
- show predicted rubric scores as draft suggestions
- let instructors accept, edit, or ignore suggestions
- never expose AI-detection accusations directly to students

### 6. Keep thresholds conservative

For `ai_detect`, prefer high thresholds like `0.85` or higher and treat them as triage only.

### 7. Cache model loading

The expensive part should be loading artifacts, not the inference math. Load checkpoints once per worker process and reuse them for many submissions.

## Production Recommendation

For this capstone, a good practical setup is:

- deterministic tests remain the source of truth for correctness
- rubric AI suggests soft scores for human review
- AI detector only creates instructor-facing flags
- plagiarism report is a triage queue, not an enforcement system

That keeps the system lightweight, scalable, and much safer academically.
