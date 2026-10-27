/*!************************************************************************
\file ModelCover.jsx
\author Xiong Yang
\par DP email: xiong.yang@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 27-10-2026
\brief
Picture on a model card in the Library and the Model Viewer.
- ModelCover({ coverUrl, photoUrl, icon })
React component. Shows the object cut out of one of the job's photos
(coverUrl, GET /jobs/:id/cover.webp, only on jobs with background masks).
If there is none, or it fails to load, it shows the job's first photo
(photoUrl), and without that the given icon.
**************************************************************************/

import { useState } from 'react';
import Icon from './Icons.jsx';

function ModelCover({ coverUrl, photoUrl, icon }) {
    // The cut-out couldn't be loaded (e.g. the server couldn't make it).
    const [isCoverBroken, setIsCoverBroken] = useState(false);

    if (coverUrl && !isCoverBroken) {
        return (
            <img
                className="library-thumb-image is-cutout"
                src={coverUrl}
                alt=""
                loading="lazy"
                draggable={false}
                onError={() => setIsCoverBroken(true)}
            />
        );
    }
    if (photoUrl) {
        return <img className="library-thumb-image" src={photoUrl} alt="" loading="lazy" draggable={false} />;
    }
    return <Icon name={icon} size={44} />;
}

export default ModelCover;
