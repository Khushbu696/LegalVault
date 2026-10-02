// Step 2 placeholder: proves the 40/60 dual-pane shell and design tokens render.
export default function Home() {
  return (
    <main className="grid h-screen grid-cols-1 md:grid-cols-[2fr_3fr]">
      <section className="flex flex-col border-r border-sand p-6">
        <h1 className="text-xl font-semibold">Contract Analyser</h1>
        <p className="mt-2 text-sm text-taupe">Drop your contract here to get started.</p>
        <div className="mt-6 flex gap-2">
          <span className="rounded-full bg-sage-wash px-3 py-1 text-xs font-medium text-sage">✓ Verified in Text</span>
          <span className="rounded-full bg-ochre-wash px-3 py-1 text-xs font-medium text-ochre-ink">⚠️ Unverified</span>
        </div>
      </section>
      <section className="hidden bg-paper p-8 md:block">
        <p className="font-serif text-lg leading-relaxed">
          The document reader will appear here.{" "}
          <mark className="quote-highlight">Cited passages are highlighted like this.</mark>
        </p>
        <p className="mt-4 font-mono text-xs text-taupe">status: idle</p>
      </section>
    </main>
  );
}
