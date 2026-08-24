"use client";

export function PrintButton() {
  return <button className="print-trigger" onClick={() => window.print()} type="button">打印 / Print</button>;
}
