# `ui/EditCommands.h` / `EditCommands.cpp`

The editor's **undoable commands**. Each is a `QUndoCommand` that stores only the values its edit touches (before and after) and is pushed onto MainWindow's `QUndoStack`. Pushing calls `redo()` straight away, so **the command itself applies the edit**. The stress tests ([StressTestRunner](../Manager/StressTestRunner.md)) use the same commands on a private stack.

Lifetime rule: the model, crop box and renderer a command points at must outlive the command. For now MainWindow clears the undo stack whenever a model is removed from the scene.

---

## `MoveModelCommand`
Changes a model's transform.

- **Constructor `(model, before, after, parent, mergeable = false)`**: saves both matrices and starts `m_lastEdit`. The menu text is *"Move <name>"*.
- **`undo()` / `redo()`**: `SetTransform(before)` / `SetTransform(after)`.
- **`id()`**: returns `kMergeId = 1001` when `mergeable`, otherwise −1 (never merges).
- **`mergeWith(other)`**: merges only another *mergeable* `MoveModelCommand` on the **same model** that arrives within **800 ms** (`kMergeWindowMs`) of the last step. It keeps its own `before`, takes the other's `after`, and restarts the timer. This collapses a run of Inspector spin-box steps into one undo step, like a gizmo drag.

## `LoadModelCommand`
A placeholder. The constructor stores the model and the before/after paths; `undo()` and `redo()` are empty for now.

## `RenameModelCommand`
- **Constructor `(model, before, after)`**: menu text *"Rename <old name>"*.
- **`undo()` / `redo()`**: `SetName(before)` / `SetName(after)`.

## `MoveCropBoxCommand`
Changes the crop box transform. It can have **child commands**, which are the `MoveSplatsCommand`s for splats carried along when *Move contents* is on.
- **`redo()`**: sets `box->transform = after`, then calls `QUndoCommand::redo()` to redo the children.
- **`undo()`**: undoes the children **first**, then sets `before`. Children are undone in reverse order.
- Menu text *"Move Crop Box"*.

## `RemoveSplatsCommand`
Removes the splats that a keep mask marks with 0. **Only the removed splats and their positions are stored**, not a second copy of the model.
- **Constructor `(renderer, model, keepMask)`**: if the mask size matches, it records the ascending indices and copies of the removed splats. Menu text *"Remove N Splats"*. `RemovedCount()` returns how many.
- **`redo()`**: rebuilds the list without the stored indices, walking the two lists together in one pass. It **clears the renderer selection**, because its indices refer to the old list, then calls `UpdateModel`.
- **`undo()`**: merges the current splats and the removed ones back together so every removed splat returns to its original index, then clears the selection and calls `UpdateModel`.

## `DeleteModelCommand`
Removes a whole model from the scene and puts it back on undo.
- **Constructor `(renderer, model, beforeRemove)`**: `beforeRemove` runs just before the model is freed, so the caller can drop pointers to it (Inspector, crop box). Menu text *"Delete <name>"*.
- **`redo()`**: finds the model's current index (if it is not found, it sets `m_model = nullptr`). It saves **everything needed to rebuild it**: splats; the untrimmed original, only when a separate copy exists (checked by comparing addresses of `SourceSplats()` and `splats()`); name; transform; trim data and trimmed flag; hidden flag. It then calls `beforeRemove`, clears the selection (model indices shift) and calls `RemoveModel(index)`.
- **`undo()`**: if the scene already has `kMaxModels`, it logs a warning and stays deleted, and `redo()` then does nothing. Otherwise it calls `SetSplats` (adding the model at the **end** of the list), restores the transform, trim state, hidden flag and original, **selects** it, and frees the saved copies.
- The restored model is a **new object**, so earlier commands that pointed at the old one would dangle. Callers clear the undo stack before pushing this command.

## `MoveSplatsCommand`
Replaces some of a model's splats with moved, rotated or scaled versions.
- **Constructor `(renderer, model, indices, deltaModel)`**: for each index it saves the splat before the change and the result of `TransformSplat(splat, deltaModel)` after it ([splat/CropBox](../splat/CropBox.md)). Menu text *"Move N Splats"*.
- **`Write(values)`** *(private)*: copies the model's splats, writes `values[i]` at `indices[i]`, and calls `UpdateModel`. If the last index is out of range (the list changed underneath), it does nothing rather than index out of range.
- **`undo()` / `redo()`**: `Write(before)` / `Write(after)`.
