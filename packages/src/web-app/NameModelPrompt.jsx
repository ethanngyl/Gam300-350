/*!************************************************************************
\file NameModelPrompt.jsx
\author Xiong Yang
\par DP email: xiong.yang@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 20-10-2026
\brief
Asks for a model's name as soon as its training finishes. Saving renames
the job the same way the Media Library's Rename does, including its .ply
in the engine samples folder. Skipping (or leaving the field empty) keeps
the default name; the model can still be renamed later from the Library.
- NameModelPrompt({ jobId, onClose })
onClose runs after the name is saved or the prompt is skipped.
**************************************************************************/

import ActionDialog from './ActionDialog.jsx';
import { renameJob } from './mediaApi.js';

function NameModelPrompt({ jobId, onClose }) {
    return (
        <ActionDialog
            title="Name your model"
            message="Training finished. Its .ply in the engine samples folder gets this name too. You can rename it later from the Media Library."
            initialValue=""
            placeholder={`Model ${jobId.slice(0, 8)}`}
            confirmLabel="Save name"
            cancelLabel="Skip"
            onConfirm={async (name) => {
                if (name.trim()) {
                    await renameJob(jobId, name);
                }
                onClose();
            }}
            onCancel={onClose}
        />
    );
}

export default NameModelPrompt;
