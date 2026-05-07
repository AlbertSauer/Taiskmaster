import React from "react";

interface State {
  hasError: boolean;
  message: string;
}

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = {
    hasError: false,
    message: "",
  };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || "Unknown error",
    };
  }

  componentDidCatch(error: Error) {
    console.error("AppErrorBoundary caught an error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
          <div className="w-full max-w-xl rounded-lg border border-border bg-card p-6">
            <h1 className="text-lg font-semibold">Something went wrong</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              The app hit a runtime error. Refresh the page, and if it happens again, share this message:
            </p>
            <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-3 text-xs">{this.state.message}</pre>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
