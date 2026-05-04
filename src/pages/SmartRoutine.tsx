import { Header } from "@/components/Header";

const SmartRoutine = () => (
  <div className="min-h-screen bg-gradient-subtle">
    <Header showActions={false} />

    <main className="container py-12">
      <div className="rounded-2xl border border-dashed border-border bg-card/60 px-6 py-20 text-center shadow-xs">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Smart Routine</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Coming soon</h1>
        <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground">
          This space is ready for your routine planning tools. We can build it out next.
        </p>
      </div>
    </main>
  </div>
);

export default SmartRoutine;
