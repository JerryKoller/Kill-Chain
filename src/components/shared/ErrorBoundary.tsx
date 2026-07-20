import { Component, type ReactNode } from "react";

interface Props {
  /** Used in the fallback message ("Failed to load <viewName>"). */
  viewName: string;
  children: ReactNode;
  /** Called when the user clicks "Try again". Lets the parent reset state if needed. */
  onReset?: () => void;
}

interface State {
  error: Error | null;
  retryKey: number;
}

/**
 * Catches render-time errors in a subtree and shows a fallback UI instead
 * of letting React unmount the entire app. Without this, a runtime error
 * in (say) the Visualizer scene would show up as a blank tab — which is
 * exactly the "tabs sometimes fail to load" symptom.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, retryKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error(
      `[ErrorBoundary] ${this.props.viewName} crashed:`,
      error,
      info,
    );
  }

  private handleRetry = () => {
    this.setState((s) => ({ error: null, retryKey: s.retryKey + 1 }));
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="h-full w-full flex items-center justify-center p-8">
          <div className="max-w-md w-full glass-strong rounded-2xl p-6 text-center">
            <div className="text-3xl mb-2">⚠</div>
            <div className="text-lg font-semibold mb-1">
              Failed to load {this.props.viewName}
            </div>
            <div className="text-xs text-dim font-mono mb-4 break-all whitespace-pre-wrap">
              {this.state.error.message}
            </div>
            <button
              onClick={this.handleRetry}
              className="btn-neon mx-auto"
            >
              ↺ Try again
            </button>
            <div className="text-[10px] text-dim mt-3 leading-relaxed">
              Full stack trace is in the DevTools console.
            </div>
          </div>
        </div>
      );
    }
    // The retryKey forces React to remount the subtree on retry so any
    // bad ref / canvas state from the crashed render is thrown away.
    return (
      <div key={this.state.retryKey} className="h-full w-full">
        {this.props.children}
      </div>
    );
  }
}
