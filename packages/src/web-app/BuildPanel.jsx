/*!************************************************************************
\file BuildPanel.jsx
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 25-11-2026
\brief
The panel in the bottom corner that follows background builds
(useBackgroundBuilds.js), laid out like the Figma's "Rendering 1 model"
and "Model ready" cards. A running build lists three steps (Aligning
photos, Building point cloud, Finishing the model) with a progress bar on
the current one; the X shrinks the panel to a small pill, and the build
keeps going. A finished build offers Open model and Show in library; a
failed one shows why, with a way to try again. One that can no longer be
followed (signed out, or the server stopped answering) says so and points
to the Media Library. Cancel build asks once before stopping it.
- BuildPanel({ builds, onOpenModel, onShowLibrary, onRetry, onCancel, onDismiss, onShowDetails })
React component. Renders nothing when there are no builds.
**************************************************************************/

import { useState } from 'react';
import Icon from './Icons.jsx';
import { BUILD_STEPS, buildStepIndex } from './useBackgroundBuilds.js';
import './BuildPanel.css';

const RUNNING_STATUSES = new Set(['uploading', 'queued', 'running']);
// The heading of a finished build's card.
const FINISHED_TITLES = { done: 'Model ready', error: 'Build failed', lost: "Can't follow this build" };

// The small picture beside a build's name: its first photo, its cut-out
// cover once it is finished, or an icon.
function BuildThumb({ build }) {
    const [isCoverBroken, setIsCoverBroken] = useState(false);
    if (build.previewUrl) return <img className="build-panel-thumb" src={build.previewUrl} alt="" />;
    if (build.status === 'done' && build.jobId && !isCoverBroken) {
        return (
            <img
                className="build-panel-thumb"
                src={`/api/v1/jobs/${build.jobId}/cover.webp`}
                alt=""
                onError={() => setIsCoverBroken(true)}
            />
        );
    }
    return <span className="build-panel-thumb is-icon"><Icon name={build.source === 'media' ? 'film' : 'layers'} size={18} /></span>;
}

// One running build: its steps, and Cancel build.
function RunningBuild({ build, onCancel, onShowDetails }) {
    const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
    const stepIndex = buildStepIndex(build);
    const isUploading = build.status === 'uploading';
    const isQueued = build.status === 'queued';
    const percent = isUploading
        ? Math.round((build.uploadFraction ?? 0) * 100)
        : Math.round((build.progress ?? 0) * 100);

    function stepStatus(index) {
        if (index < stepIndex) return 'Done';
        if (index > stepIndex) return 'Queued';
        if (isQueued) return 'Waiting';
        return `${percent}%`;
    }

    return (
        <div className="build-panel-build">
            <div className="build-panel-model">
                <BuildThumb build={build} />
                <span className="build-panel-model-copy">
                    <strong>{build.label}</strong>
                    <small>{build.detail}</small>
                </span>
            </div>

            <ol className="build-panel-steps">
                {BUILD_STEPS.map((step, index) => {
                    const state = index < stepIndex ? 'is-done' : index === stepIndex ? 'is-active' : 'is-pending';
                    let label = step.label;
                    if (index === 0 && isUploading) label = build.source === 'media' ? 'Uploading videos' : 'Uploading photos';
                    return (
                        <li key={step.id} className={`build-panel-step ${state}`}>
                            <span className="build-panel-step-mark" aria-hidden="true">
                                {index < stepIndex && <Icon name="check" size={10} />}
                            </span>
                            <span className="build-panel-step-label">{label}</span>
                            <span className="build-panel-step-status">{stepStatus(index)}</span>
                            {index === stepIndex && !isQueued && (
                                <span className="build-panel-step-bar" aria-hidden="true">
                                    <span style={{ width: `${percent}%` }} />
                                </span>
                            )}
                        </li>
                    );
                })}
            </ol>

            {isQueued && build.waitingText && <p className="build-panel-note">{build.waitingText}</p>}

            <div className="build-panel-links">
                {isConfirmingCancel ? (
                    <>
                        <span>Stop this build?</span>
                        <button
                            type="button"
                            className="build-panel-link is-danger"
                            onClick={() => {
                                onCancel(build.key);
                            }}
                        >
                            Yes, cancel
                        </button>
                        <button
                            type="button"
                            className="build-panel-link"
                            onClick={() => {
                                setIsConfirmingCancel(false);
                            }}
                        >
                            Keep going
                        </button>
                    </>
                ) : (
                    <>
                        {build.jobId && (
                            <button
                                type="button"
                                className="build-panel-link"
                                onClick={() => {
                                    onShowDetails(build);
                                }}
                            >
                                Details
                            </button>
                        )}
                        <button
                            type="button"
                            className="build-panel-link"
                            onClick={() => {
                                setIsConfirmingCancel(true);
                            }}
                        >
                            Cancel build
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

function BuildPanel({ builds, onOpenModel, onShowLibrary, onRetry, onCancel, onDismiss, onShowDetails }) {
    const [isMinimised, setIsMinimised] = useState(false);

    if (builds.length === 0) return null;

    const runningBuilds = builds.filter((build) => RUNNING_STATUSES.has(build.status));
    const finishedBuilds = builds.filter((build) => !RUNNING_STATUSES.has(build.status));
    const runningTitle = `Rendering ${runningBuilds.length} model${runningBuilds.length === 1 ? '' : 's'}`;

    // Shrunk: a pill with the first build's progress, until a build finishes.
    if (isMinimised && finishedBuilds.length === 0 && runningBuilds.length > 0) {
        const first = runningBuilds[0];
        const percent = first.status === 'uploading'
            ? Math.round((first.uploadFraction ?? 0) * 100)
            : Math.round((first.progress ?? 0) * 100);
        return (
            <button
                type="button"
                className="build-panel-pill"
                onClick={() => {
                    setIsMinimised(false);
                }}
            >
                <span className="build-panel-pill-spinner" aria-hidden="true" />
                {runningTitle}
                <span className="build-panel-pill-percent">{first.status === 'queued' ? 'Waiting' : `${percent}%`}</span>
            </button>
        );
    }

    return (
        <aside className="build-panel" aria-live="polite" aria-label="Builds">
            {finishedBuilds.map((build) => (
                <section key={build.key} className="build-panel-card">
                    <div className="build-panel-head">
                        <h2>{FINISHED_TITLES[build.status] ?? 'Build cancelled'}</h2>
                        <button
                            type="button"
                            className="build-panel-close"
                            aria-label="Close"
                            onClick={() => {
                                onDismiss(build.key);
                            }}
                        >
                            <Icon name="close" size={14} />
                        </button>
                    </div>
                    <div className="build-panel-model">
                        <BuildThumb build={build} />
                        <span className="build-panel-model-copy">
                            <strong>{build.label}</strong>
                            <small>{build.status === 'done' ? `Built from ${build.detail}` : build.detail}</small>
                        </span>
                    </div>
                    {(build.status === 'error' || build.status === 'lost') && <p className="build-panel-error">{build.error}</p>}
                    <div className="build-panel-actions">
                        {build.status === 'lost' && (
                            <button
                                type="button"
                                className="forma-btn"
                                onClick={() => {
                                    playSound('tap');
                                    onShowLibrary(build);
                                }}
                            >
                                Open Media Library
                            </button>
                        )}
                        {build.status === 'done' && (
                            <>
                                <button
                                    type="button"
                                    className="forma-btn forma-btn-primary"
                                    onClick={() => {
                                        onOpenModel(build);
                                    }}
                                >
                                    Open model
                                </button>
                                <button
                                    type="button"
                                    className="forma-btn"
                                    onClick={() => {
                                        onShowLibrary(build);
                                    }}
                                >
                                    Show in library
                                </button>
                            </>
                        )}
                        {build.status === 'error' && build.files && (
                            <button
                                type="button"
                                className="forma-btn forma-btn-primary"
                                onClick={() => {
                                    onRetry(build);
                                }}
                            >
                                {build.source === 'media' ? 'Back to Video Extractor' : 'Open in Photo Editor'}
                            </button>
                        )}
                    </div>
                </section>
            ))}

            {runningBuilds.length > 0 && (
                <section className="build-panel-card">
                    <div className="build-panel-head">
                        <h2>{runningTitle}</h2>
                        <button
                            type="button"
                            className="build-panel-close"
                            aria-label="Shrink"
                            title="Shrink (the build keeps going)"
                            onClick={() => {
                                setIsMinimised(true);
                            }}
                        >
                            <Icon name="close" size={14} />
                        </button>
                    </div>
                    {runningBuilds.map((build) => (
                        <RunningBuild key={build.key} build={build} onCancel={onCancel} onShowDetails={onShowDetails} />
                    ))}
                </section>
            )}
        </aside>
    );
}

export default BuildPanel;