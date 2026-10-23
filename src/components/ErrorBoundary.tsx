import React from "react";
import { MessageCard } from "azure-devops-ui/Components/MessageCard/MessageCard";
import { MessageCardSeverity } from "azure-devops-ui/Components/MessageCard/MessageCard.Props";
import { getErrorMessage } from "../utils/errorUtils";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

/**
 * Top-level error boundary that catches unhandled React render errors and
 * displays a user-friendly fallback instead of crashing the entire extension.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(err: unknown): ErrorBoundaryState {
    const message = getErrorMessage(err);
    return { hasError: true, message };
  }

  componentDidCatch(err: Error, info: React.ErrorInfo) {
    console.error("Unhandled render error:", err, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24 }}>
          <MessageCard severity={MessageCardSeverity.Error}>
            <strong>Something went wrong.</strong>
            <p style={{ margin: "8px 0 0" }}>{this.state.message}</p>
          </MessageCard>
        </div>
      );
    }
    return this.props.children;
  }
}
