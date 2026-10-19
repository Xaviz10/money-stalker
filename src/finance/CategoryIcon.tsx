import { Icon, type IconName } from "../design-system/ui";

export const categoryIcons: Record<string, IconName> = {
  food: "groceries",
  restaurants: "restaurant",
  car: "car",
  delivery: "delivery",
  utilities: "utilities",
  home: "home",
  transport: "transport",
  health: "heart",
  leisure: "leisure",
  other: "other",
  uncategorized: "other",
};

export function CategoryIcon({
  categoryId,
  size = 16,
}: {
  categoryId: string;
  size?: number;
}) {
  return <Icon name={categoryIcons[categoryId] ?? "other"} size={size} />;
}
