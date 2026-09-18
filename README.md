# 3D Object Scanner & Visualizer

> Team CoDefine - Real World Object Scanning to 3D Model Conversion

Capture/Takes in real-world object images and turns it into an interactable 3D model. The front-end scans an object either via a camera, uploaded files or a youtube video from multiple angles; the Python back-end will then reconstruct it with photogrammetry + Gaussian splatting pipeline; the custom renderer displays the final result.

---

## Overview

This project takes a set of photographs of a physical object and produces a 3D asset that can be viewed in a custom renderer. It is built as three loosely-coupled parts so the team can work on them in parallel:

- **Front-end (scanner):** a mobile app that captures overlapping photos of an object from many angles. Early development targets small objects on a rotating stand (spinning-photo-booth style) for controlled, repeatable captures.
- **Back-end (reconstruction pipeline):** a Python service that runs the captured images through COLMAP (structure-from-motion + multi-view stereo) to recover camera poses and a point cloud, then through Gaussian Splatting, and exports a renderable 3D asset.
- **Engine (renderer/visualizer):** a custom 3D renderer that loads and displays the reconstructed asset.

The end goal of the project is to have as many additional features/solve current problems that similar existing applications are having in the market.

## Tech stack

| Part | Stack |
| --- | --- |
| Scanner (front-end) | Mobile app _(framework TBD)_ |
| Reconstruction | Python, COLMAP _(external — see below)_, Gaussian Splatting |
| API / orchestration | Python _(e.g. FastAPI)_ |
| Renderer (engine) | Custom 3D renderer _(target TBD — native C++/OpenGL or web)_ |

## Prerequisites/How to Set up

Application Installations:
- Nodejs(Default Installation Settings): https://nodejs.org/en
- Visual Studio Community 22/26(With CMake and C++ packages): https://visualstudio.microsoft.com/downloads/
- Python 3.10 or later: https://www.python.org/downloads/
- Git: https://git-scm.com/download/win

## How to Run
- Double click start.bat in the packages folder, any missing packages will be automatically installed by the script

## Current Features
- Basic Frontend, allows for navigation to image capturing/uploading page
- Capable of generating a downloadable .ply file from uploaded images
- Youtube frame image extractor, images per frame can be modified

## Current Issues
-  The model used for training is taxing and requires a strong GPU, the model training is reliant on a CUDA GPU meaning the host system will always need to remain online, other options are being explored at the moment.
-  The youtube frame extractor can extract images but the quality and kind of images captured might not be compatible with colmap's requirements.

## Team

Team Codefine GAM300-350

| Name | Role |
| --- | --- |
| Ethan Ng | Tech/Team Lead |
| Gerard | Design |
| Clement Ang | Engine Champion |
| Xiong Yang | Gaussian/Colmap |
| Gabriel | Frontend |
| Bryan Lim | Backend |