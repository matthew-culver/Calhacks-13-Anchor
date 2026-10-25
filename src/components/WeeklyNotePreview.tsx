// The parent's weekly note, word for word (the same sentences the backend sends), so the kid
// knows exactly what their parent hears from Anchor.

import { Icon } from "@/components/icons";

export type WeeklyNote = { subject: string; lines: string[] };

export function WeeklyNotePreview({ note, parentName }: { note: WeeklyNote | null | undefined; parentName: string }) {
  if (!note) return null;
  return (
    <details className="group rounded-3xl border border-line bg-surface shadow-card">
      <summary className="flex min-h-tap cursor-pointer items-center justify-between gap-3 rounded-3xl px-6 py-4 text-xl font-semibold">
        <span className="flex items-center gap-3">
          <Icon name="mail" className="h-6 w-6 text-action" />
          {`What ${parentName} gets on Sunday`}
        </span>
        <Icon name="chevronDown" className="details-chevron h-6 w-6 text-muted transition-transform" />
      </summary>
      <div className="flex flex-col gap-3 border-t border-line px-6 py-5 text-lg">
        <p className="font-semibold">{note.subject}</p>
        {note.lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
        <p className="text-base text-muted">This week so far. It&apos;s the only email Anchor sends on its own, once a week.</p>
      </div>
    </details>
  );
}
