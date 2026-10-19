import { Icon, type IconName } from "../design-system/ui";

export const categoryIcons: Record<string, IconName> = {
  food: "groceries",
  "food-supermarket": "groceries",
  restaurants: "restaurant",
  "restaurants-cafe": "restaurant",
  car: "car",
  "car-fuel": "car",
  "car-tolls": "car",
  "car-parking": "car",
  "car-maintenance": "car",
  delivery: "delivery",
  utilities: "utilities",
  "utilities-internet": "utilities",
  "utilities-power": "utilities",
  "utilities-water": "utilities",
  "utilities-gas": "utilities",
  home: "home",
  transport: "transport",
  health: "heart",
  leisure: "leisure",
  salary: "incoming",
  "salary-payroll": "incoming",
  "salary-bonus": "incoming",
  "freelance-income": "incoming",
  "investment-income": "incoming",
  "rental-income": "incoming",
  "other-income": "incoming",
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
