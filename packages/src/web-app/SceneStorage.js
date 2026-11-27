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
createSceneObject(model, objects) makes a new object for a model (used by
the Scene Builder's Add model and the model page's Add to scene).

Scenes are saved to the signed-in account through the backend's /scenes
routes (GET /scenes, POST /scenes, GET/PUT/DELETE /scenes/:id), so each
account sees only its own. With SCENES_API_READY = false they are kept in
this browser's localStorage instead.
**************************************************************************/

const SCENES_API_READY = true;

// Lets the screen say where a save went.
export const SCENES_SAVED_ON_SERVER = SCENES_API_READY;

const DEFAULT_TRIM = { strength: 0, minOpacity: 0, maxSplatSize: 0, density: 0 };

export function makeObjectId() {
    // Not crypto.randomUUID: that needs HTTPS, and the app is also opened over plain LAN http.
    return `object-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// A scene object for model ({ id, name }), placed at the origin and named
// after the model (numbered if it is already in the scene).
export function createSceneObject(model, objects) {
    const copies = objects.filter((sceneObject) => sceneObject.jobId === model.id).length;
    return {
        objectId: makeObjectId(),
        jobId: model.id,
        name: copies === 0 ? model.name : `${model.name} (${copies + 1})`,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        trim: { ...DEFAULT_TRIM },
        isHidden: false,
    };
}

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
    if (res.status === 401) throw new Error('Sign in to save scenes.');
    if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `HTTP ${res.status}`);
    }
    return res.status === 204 ? null : res.json();
}

// Summaries for lists: { id, name, updatedAt, objectCount }, newest first.
export async function listScenes() {
    if (SCENES_API_READY) return requestJson('/api/v1/scenes');

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
    if (SCENES_API_READY) return requestJson(`/api/v1/scenes/${sceneId}`);

    const scene = readLocalScenes().find((savedScene) => savedScene.id === sceneId);
    if (!scene) throw new Error('Scene not found.');
    return scene;
}

// Creates the scene when it has no id yet, otherwise updates it.
// Resolves to the saved scene (with its id and timestamps).
export async function saveScene(scene) {
    const now = Date.now();

    if (SCENES_API_READY) {
        if (!scene.id) return requestJson('/api/v1/scenes', { method: 'POST', body: JSON.stringify(scene) });
        return requestJson(`/api/v1/scenes/${scene.id}`, { method: 'PUT', body: JSON.stringify(scene) });
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
    if (SCENES_API_READY) return requestJson(`/api/v1/scenes/${sceneId}`, { method: 'DELETE' });

    writeLocalScenes(readLocalScenes().filter((savedScene) => savedScene.id !== sceneId));
    return null;
}