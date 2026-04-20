# Sample Python `I/O` Assignment

This folder contains a complete sample Python assignment you can use to test Gradeforge end to end.

## Assignment title

```text
Warehouse Inventory Console
```

## Assignment prompt

Write a Python program that manages a warehouse inventory using standard input and standard output.

### Input format

- The first line contains an integer `N`, the number of commands.
- The next `N` lines each contain one command.

### Supported commands

- `ADD sku qty`
- `SHIP sku qty`
- `SET sku qty`
- `DELETE sku`
- `RENAME oldSku newSku`

### Rules

- `ADD`: increase the quantity for the SKU
- `SHIP`: reduce quantity only if the SKU exists and has enough quantity
- `SET`: replace the quantity; if it becomes `0`, remove the SKU
- `DELETE`: remove the SKU if it exists
- `RENAME`: rename the SKU; if the target SKU already exists, merge quantities
- If an item reaches quantity `0`, remove it
- Print the final inventory sorted by SKU in ascending order
- If the inventory is empty, print `EMPTY`
- Always print `TOTAL <sum>` on the last line

## Gradeforge builder setup

Use:

- `Mode`: `I/O`
- `Language`: `Python 3`
- `Suite name`: `warehouse-io-tests`
- `Visibility`: `Private`
- `Timeout (ms)`: `3000`

For Python `I/O`:

- do not fill `Main class`

## Files in this folder

- `main.py`
  - sample correct student solution
- `case1_input.txt`
- `case1_output.txt`
- `case2_input.txt`
- `case2_output.txt`
- `case3_input.txt`
- `case3_output.txt`

## How to test locally

From the repo root:

```bash
python3 docs/sample_python_io_assignment/main.py < docs/sample_python_io_assignment/case1_input.txt
python3 docs/sample_python_io_assignment/main.py < docs/sample_python_io_assignment/case2_input.txt
python3 docs/sample_python_io_assignment/main.py < docs/sample_python_io_assignment/case3_input.txt
```

## Expected results

Case 1 should print:

```text
A100 7
C300 7
D400 1
TOTAL 15
```

Case 2 should print:

```text
CS2 9
M1 1
TOTAL 10
```

Case 3 should print:

```text
EMPTY
TOTAL 0
```
