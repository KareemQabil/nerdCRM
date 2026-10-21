import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

/** Sanitized application-level error state; never displays stack traces or user data. */
export class UiErrorBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  componentDidCatch(_error: Error, _details: ErrorInfo) {
    // The global state remains safe for users; incident logging belongs to a secured backend.
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const ar = document.documentElement.lang !== "en";
    return <main className="ioeti-crash-screen" role="alert">
      <div className="ioeti-crash-card">
        <AlertTriangle size={30} aria-hidden="true"/>
        <span className="eyebrow">UI-UNEXPECTED</span>
        <h1>{ar ? "حصل خطأ غير متوقع في الواجهة" : "Something went wrong in the workspace"}</h1>
        <p>{ar ? "مش هنقول إن العملية نجحت من غير تأكيد. ممكن تعيد فتح الشاشة؛ لو كنت بتحفظ سجل، راجع حالته قبل تكرار الإجراء." : "We cannot confirm that the last action succeeded. Reopen the workspace and verify any record before repeating a write."}</p>
        <button className="btn btn-primary" type="button" onClick={() => window.location.reload()}>
          <RotateCcw size={17}/>{ar ? "إعادة تحميل الواجهة" : "Reload workspace"}
        </button>
      </div>
    </main>;
  }
}
