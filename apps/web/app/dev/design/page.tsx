import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { Eyebrow } from "@/components/ui/Eyebrow";

// Component gallery: the deterministic surface for component tests and visual review
// (design-system plan, Tasks 7-8). Sample values are constants.
const ROWS = [["삼성전자", "71,200"], ["SK하이닉스", "182,500"]] as const;

export default function DesignGalleryPage() {
  return (
    <div className="flex flex-col gap-8 p-6">
      <section data-testid="gallery-eyebrow"><Eyebrow index={1} label="market" /></section>
      <section>
        <table data-testid="gallery-table">
          <thead>
            <tr>
              <th scope="col" className="type-caption px-4 py-2 text-left uppercase text-[var(--ink-muted)]"><BilingualLabel k="name" /></th>
              <th scope="col" className="type-caption px-4 py-2 text-right uppercase text-[var(--ink-muted)]"><BilingualLabel k="price" /></th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([name, price]) => (
              <tr key={name}>
                <td className="type-body px-4 py-3">{name}</td>
                <td className="type-mono px-4 py-3 text-right">{price}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
