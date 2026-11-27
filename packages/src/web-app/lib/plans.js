/*!************************************************************************
\file plans.js
\author Bryan Lim Jun Jie
\par DP email: bryanjunjie.lim@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 17-11-2026
\brief
The Genesis plans, shared by the landing page's Plans section, the top
bar's storage meter and Account > Plans. Prototype plans, not final plan
details: prices aren't decided yet, and everyone is on Free for now.
- PLANS
Each plan: id, name, description (who it is for), storage, models,
export formats, features (the list on the landing page), and isFeatured
for the one to highlight.
- CURRENT_PLAN_ID
The plan every account is on.
- currentPlan()
The PLANS entry for CURRENT_PLAN_ID.
**************************************************************************/

export const CURRENT_PLAN_ID = 'free';

export const PLANS = [
    {
        id: 'free',
        name: 'Genesis Free',
        description: 'For trying Genesis',
        storage: '5 GB',
        storageGb: 5,
        models: '10 a month',
        formats: ['.obj'],
        features: ['5 GB storage', '10 models a month', 'OBJ export', 'Photo editor'],
    },
    {
        id: 'pro',
        name: 'Genesis Pro',
        description: 'For independent creators',
        storage: '100 GB',
        storageGb: 100,
        models: 'Unlimited',
        formats: ['All formats'],
        features: ['100 GB storage', 'Unlimited models', 'All export formats', 'Scene builder', 'Video frame extractor'],
        isFeatured: true,
    },
    {
        id: 'max',
        name: 'Genesis Max',
        description: 'For studios and shops',
        storage: '1 TB',
        storageGb: 1000,
        models: 'Unlimited',
        formats: ['All formats', 'PLY splat'],
        features: ['1 TB storage', 'Priority processing', 'PLY splat export', 'Commercial licence'],
    },
];

export function currentPlan() {
    return PLANS.find((plan) => plan.id === CURRENT_PLAN_ID);
}