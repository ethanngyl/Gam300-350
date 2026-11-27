/*!************************************************************************
\file AppErrorBoundary.jsx
\author Ethan Ng Yong Le
\par DP email: n.ethanyongle@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 28-11-2026
\brief
Catches an error thrown while a screen renders, so one broken screen shows
a message with Reload / Back to Home instead of React unmounting the whole
app and leaving a blank page. Wraps the app in main.jsx. The Scene Builder
viewport keeps its own, narrower boundary (SceneViewport.jsx).
- AppErrorBoundary({ children })
React class component.
**************************************************************************/

import { Component } from 'react';

const panelStyle = {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
    boxSizing: 'border-box',
    background: 'var(--forma-bg, #0d0d14)',
    color: 'var(--forma-text, #f4fbfd)',
    font: '15px system-ui, sans-serif',
    textAlign: 'center',
};

const buttonStyle = {
    margin: '0 6px',
    padding: '8px 16px',
    borderRadius: '6px',
    border: '1px solid currentColor',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    font: 'inherit',
};

class AppErrorBoundary extends Component {
    state = { error: null };

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        console.error('A screen crashed:', error, info?.componentStack);
    }

    render() {
        if (!this.state.error) return this.props.children;
        return (
            <div style={panelStyle} role="alert">
                <div style={{ maxWidth: '420px' }}>
                    <p style={{ margin: '0 0 8px', fontWeight: 600 }}>Something went wrong on this page.</p>
                    <p style={{ margin: '0 0 20px', opacity: 0.7, fontSize: '13px' }}>
                        Your models and photos are safe on the server. Reload the page, or go back to Home.
                    </p>
                    <button type="button" style={buttonStyle} onClick={() => window.location.reload()}>
                        Reload
                    </button>
                    <button
                        type="button"
                        style={buttonStyle}
                        onClick={() => {
                            window.location.hash = '';
                            window.location.reload();
                        }}
                    >
                        Back to Home
                    </button>
                </div>
            </div>
        );
    }
}

export default AppErrorBoundary;
