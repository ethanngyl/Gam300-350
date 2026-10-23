/*!************************************************************************
\file mediaApi.js
\author Xiong Yang
\par DP email: xiong.yang@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 20-10-2026
\brief
Calls used by the Media Library to rename and delete 3D models. A job is
both a 3D model and the photo batch it was made from, so the batch shows
the model's name and is deleted with it. Every call resolves with the
server's JSON or rejects with its { error } message, ready to show to the
user.
**************************************************************************/

async function request(url, options) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Server returned ${res.status}`);
    return data;
}

function jsonBody(method, body) {
    return {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    };
}

// The user's name for a job, else "<prefix> <short id>".
export function jobDisplayName(job, prefix) {
    return job.name || `${prefix} ${job.id.slice(0, 8)}`;
}

// An empty name resets the job to its default name.
export function renameJob(jobId, name) {
    return request(`/jobs/${jobId}`, jsonBody('PATCH', { name }));
}

// Removes the job's photos and model for good.
export function deleteJob(jobId) {
    return request(`/jobs/${jobId}/files`, { method: 'DELETE' });
}
