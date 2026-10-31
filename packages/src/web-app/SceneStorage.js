/*!************************************************************************
\file SceneStorage.js
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 21-10-2026
\brief
Saving and loading Scene Builder scenes. A scene is a small JSON record:
{ id, name, createdAt, updatedAt, background, renderMode, objects[] }
where each object is { objectId, jobId, name, position, rotation, scale,
trim, isHidden }. The models themselves stay in /jobs.

PLACEHOLDER: the backend has no /scenes endpoints yet, so with
SCENES_API_READY = false scenes are kept in this browser's localStorage.
Once the server adds them, set SCENES_API_READY = true; the endpoints this
expects are GET /scenes, POST /scenes, GET/PUT/DELETE /scenes/:id.
**************************************************************************/

// TODO(backend): flip to true once /scenes exists on the server.
const SCENES_API_READY = false;

// Lets the screen say where a save went.
export const SCENES_SAVED_ON_SERVER = SCENES_API_READY;

// The Scene Builder's settings for a scene that hasn't been saved yet.
export const NEW_SCENE_INFO = {
    id: null,
    name: 'Untitled scene',
    // Same as --forma-panel, so the viewport matches the site's panels.
    background: '#18181b',
    renderMode: 'splats',
    hasUnsavedChanges: false,
};

const LOCAL_STORAGE_KEY = 'genesis.scenes';

function readLocalScenes() {
    try {
        const saved = window.localStorage.getItem(LOCAL_STORAGE_KEY);
        return saved ? JSON.parse(saved) : [];
    } catch {
        return [];
    }
}

function writeLocalScenes(scenes) {
    try {
        window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(scenes));
        return true;
    } catch {
        return false;
    }
}

function makeSceneId() {
    return `scene-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function requestJson(url, options) {
    const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.status === 204 ? null : res.json();
}

// Summaries for lists: { id, name, updatedAt, objectCount }, newest first.
export async function listScenes() {
    if (SCENES_API_READY) return requestJson('/scenes');

    return readLocalScenes()
        .map((scene) => ({
            id: scene.id,
            name: scene.name,
            updatedAt: scene.updatedAt,
            objectCount: scene.objects.length,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadScene(sceneId) {
    if (SCENES_API_READY) return requestJson(`/scenes/${sceneId}`);

    const scene = readLocalScenes().find((savedScene) => savedScene.id === sceneId);
    if (!scene) throw new Error('Scene not found.');
    return scene;
}

// Creates the scene when it has no id yet, otherwise updates it.
// Resolves to the saved scene (with its id and timestamps).
export async function saveScene(scene) {
    const now = Date.now();

    if (SCENES_API_READY) {
        if (!scene.id) return requestJson('/scenes', { method: 'POST', body: JSON.stringify(scene) });
        return requestJson(`/scenes/${scene.id}`, { method: 'PUT', body: JSON.stringify(scene) });
    }

    const scenes = readLocalScenes();
    const existingIndex = scenes.findIndex((savedScene) => savedScene.id === scene.id);
    const savedScene = {
        ...scene,
        id: scene.id ?? makeSceneId(),
        createdAt: existingIndex >= 0 ? scenes[existingIndex].createdAt : now,
        updatedAt: now,
    };

    if (existingIndex >= 0) scenes[existingIndex] = savedScene;
    else scenes.push(savedScene);

    if (!writeLocalScenes(scenes)) throw new Error('This browser blocked saving.');
    return savedScene;
}

export async function deleteScene(sceneId) {
    if (SCENES_API_READY) return requestJson(`/scenes/${sceneId}`, { method: 'DELETE' });

    writeLocalScenes(readLocalScenes().filter((savedScene) => savedScene.id !== sceneId));
    return null;
}