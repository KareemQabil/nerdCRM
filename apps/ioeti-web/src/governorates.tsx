/** Egypt's 27 governorates (a fact, not a rule), with the codes the server uses (PolicyCatalog.GOVERNORATES). D-12 routing may use them. */
export const GOVERNORATES: [code: string, ar: string, en: string][] = [
  ["CAIRO", "القاهرة", "Cairo"], ["GIZA", "الجيزة", "Giza"], ["ALEXANDRIA", "الإسكندرية", "Alexandria"], ["QALYUBIA", "القليوبية", "Qalyubia"],
  ["SHARQIA", "الشرقية", "Sharqia"], ["DAKAHLIA", "الدقهلية", "Dakahlia"], ["GHARBIA", "الغربية", "Gharbia"], ["MONUFIA", "المنوفية", "Monufia"],
  ["BEHEIRA", "البحيرة", "Beheira"], ["KAFR_EL_SHEIKH", "كفر الشيخ", "Kafr El Sheikh"], ["DAMIETTA", "دمياط", "Damietta"],
  ["PORT_SAID", "بورسعيد", "Port Said"], ["ISMAILIA", "الإسماعيلية", "Ismailia"], ["SUEZ", "السويس", "Suez"], ["NORTH_SINAI", "شمال سيناء", "North Sinai"],
  ["SOUTH_SINAI", "جنوب سيناء", "South Sinai"], ["RED_SEA", "البحر الأحمر", "Red Sea"], ["MATROUH", "مطروح", "Matrouh"],
  ["NEW_VALLEY", "الوادي الجديد", "New Valley"], ["FAIYUM", "الفيوم", "Faiyum"], ["BENI_SUEF", "بني سويف", "Beni Suef"], ["MINYA", "المنيا", "Minya"],
  ["ASYUT", "أسيوط", "Asyut"], ["SOHAG", "سوهاج", "Sohag"], ["QENA", "قنا", "Qena"], ["LUXOR", "الأقصر", "Luxor"], ["ASWAN", "أسوان", "Aswan"],
];
export const governorateName = (code: string | null | undefined, ar: boolean) =>
  code ? GOVERNORATES.find(g => g[0] === code)?.[ar ? 1 : 2] ?? code : "—";

/** A governorate select; "" is "not given". */
export function GovernorateOptions({ ar, none }: { ar: boolean; none: string }) {
  return <><option value="">{none}</option>{GOVERNORATES.map(([code, a, e]) => <option key={code} value={code}>{ar ? a : e}</option>)}</>;
}
