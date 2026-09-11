# Gaussian Splat Assets

Trained 3D Gaussian Splatting point clouds (`.ply`) live here.

## Workflow (do this once per scene, then commit the result)

1. **Capture** 40–150 overlapping photos of the subject → `gsplat-tools/<scene>/input/`
2. **COLMAP** recovers camera poses:
   `colmap automatic_reconstructor --workspace_path <scene> --image_path <scene>/input`
3. **Brush** trains on the COLMAP output and exports a `.ply`
4. **Copy** the exported `.ply` into this folder and commit it.

## Important

- `.ply` files are tracked by **Git LFS** (see `../../.gitattributes`). Do not disable this —
  committing them as plain git would permanently bloat the repo.
- The authoring tools (COLMAP, Brush) live **outside** this repo in `gsplat-tools/`.
  Only the trained `.ply` asset belongs here; teammates render it with the engine's
  OpenGL splat renderer and never need CUDA, COLMAP, or Brush.
