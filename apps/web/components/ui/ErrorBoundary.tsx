"use client";

import React from "react";
import { emitClientPerformanceEvent } from "@/lib/api";
import { useT } from "@/lib/i18n/locale";

interface BoundaryProps {
    children: React.ReactNode;
    fallbackTitle?: string;
    fallbackMessage?: string;
    monitorComponent?: string;
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
        console.error("UI Render Blocked by Error Boundary:", error, errorInfo);
        void emitClientPerformanceEvent({
            level: "error",
            scope: "chart",
            operation: "chart.render_error",
            status: "error",
            route: typeof window !== "undefined" ? window.location.pathname : null,
            component: this.props.monitorComponent ?? this.props.fallbackTitle ?? "error_boundary",
            error_code: "react_render_failure",
            message: error.message,
            metadata: {
                has_component_stack: Boolean(errorInfo.componentStack),
            },
        });
    }

    render() {
        if (this.state.hasError) {
            return <ErrorBoundaryFallback title={this.props.fallbackTitle} message={this.props.fallbackMessage} error={this.state.error} />;
        }

        return this.props.children;
    }
}

function ErrorBoundaryFallback({ title, message, error }: { title?: string; message?: string; error: Error | null }) {
    const t = useT();
    return (
        <div className="w-full border border-[var(--status-error-border)] bg-[var(--status-error-surface)] p-6 text-center animate-in fade-in zoom-in-95 duration-200">
            <div className="w-12 h-12 bg-[var(--surface-raised)] rounded-full mx-auto flex items-center justify-center mb-3">
                <svg className="w-6 h-6 text-[var(--status-error-ink)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
            </div>
            <h3 className="type-panel-title text-[var(--status-error-ink)]">
                {title || t("common.renderFailureTitle")}
            </h3>
            <p className="type-body text-[var(--status-error-ink)] mt-2">
                {message || t("common.renderFailureBody")}
            </p>
            <p className="type-mono text-[var(--status-error-ink)] mt-4 truncate max-w-sm mx-auto bg-[var(--surface-raised)] p-2 border border-[var(--status-error-border)]">
                {error?.message}
            </p>
        </div>
    );
}
