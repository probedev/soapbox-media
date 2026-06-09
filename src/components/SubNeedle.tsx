/**
 * A compact labeled needle for the home page's independent-vs-legacy split,
 * sitting under the master Soapbox Index needle. Reuses SoapboxNeedle at a
 * smaller size (it scales via its viewBox).
 */
import { SoapboxNeedle } from "./SoapboxNeedle";

export function SubNeedle({
  label,
  value,
  hasData,
}: {
  label: string;
  value: number;
  hasData: boolean;
}) {
  const dir = value >= 0 ? "R+" : "L+";
  const color = value >= 0 ? "text-red-600" : "text-blue-600";
  return (
    <div className="flex flex-col items-center">
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <SoapboxNeedle value={hasData ? value : 0} width={180} height={117} />
      <div
        className={`text-2xl font-semibold tabular-nums ${
          hasData ? color : "text-ink-faintest"
        }`}
      >
        {hasData ? `${dir}${Math.abs(value).toFixed(1)}` : "-"}
      </div>
    </div>
  );
}
