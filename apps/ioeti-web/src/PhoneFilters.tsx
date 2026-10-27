import { useEffect, useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";

const PHONE = "(max-width: 760px)";

function usePhone() {
  const media = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(PHONE) : null);
  const [phone, setPhone] = useState(() => !!media()?.matches);
  useEffect(() => {
    const query = media();
    if (!query) return;
    const change = () => setPhone(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return phone;
}

/**
 * Filters that stay in view on a wide screen and fold behind one button on a phone, so the records come first. The
 * button says how many filters are on.
 */
export function PhoneFilters({ label, active, children }: { label: string; active: number; children: ReactNode }) {
  const phone = usePhone();
  if (!phone) return <>{children}</>;
  return <details className="phone-filters">
    <summary><SlidersHorizontal size={16}/>{label}{active > 0 && <span className="phone-filters-count">{active}</span>}</summary>
    {children}
  </details>;
}
