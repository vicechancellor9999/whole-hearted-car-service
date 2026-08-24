"use client";

export function PrintButton({ label = "打印 / Print" }: { label?: string }) {
  return <button className="print-trigger" onClick={() => window.print()} type="button">{label}</button>;
}
