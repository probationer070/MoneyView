"use client";

import React from "react";

interface BoundaryProps {
    children: React.ReactNode;
    fallbackTitle?: string;
    fallbackMessage?: string;
}

interface BoundaryState {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends React.Component<BoundaryProps, BoundaryState> {
    constructor(props: BoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): BoundaryState {
        // Prevent white-screening by triggering explicit visual fallback components
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        // Here we would link into external logging observability platforms like Sentry
        console.error("UI Render Blocked by Error Boundary:", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="w-full rounded-[var(--radius)] border border-red-200 bg-red-50 p-6 text-center animate-in fade-in zoom-in-95 duration-200">
                    <div className="w-12 h-12 bg-red-100 rounded-full mx-auto flex items-center justify-center mb-3">
                        <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <h3 className="text-lg font-bold text-red-800 tracking-tight">
                        {this.props.fallbackTitle || "Component Render Failure"}
                    </h3>
                    <p className="text-sm text-red-600 mt-2">
                        {this.props.fallbackMessage || "An unexpected error broke the layout context for this graphic. Logs have been traced locally."}
                    </p>
                    <p className="text-xs text-red-400 font-mono mt-4 truncate max-w-sm mx-auto bg-[var(--bg-surface)] p-2 rounded-md shadow-inner border border-red-100">
                        {this.state.error?.message}
                    </p>
                </div>
            );
        }

        return this.props.children;
    }
}
