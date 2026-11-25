import {
  ShoppingCart,
  Utensils,
  Car,
  Home,
  Repeat,
  ShoppingBag,
  HeartPulse,
  ShieldCheck,
  MoreHorizontal,
  Wallet,
  Coffee,
  Fuel,
  Gift,
  Plane,
  Smartphone,
  Tv,
  Dumbbell,
  GraduationCap,
  Wrench,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  ShoppingCart,
  Utensils,
  Car,
  Home,
  Repeat,
  ShoppingBag,
  HeartPulse,
  ShieldCheck,
  MoreHorizontal,
  Wallet,
  Coffee,
  Fuel,
  Gift,
  Plane,
  Smartphone,
  Tv,
  Dumbbell,
  GraduationCap,
  Wrench,
  Sparkles,
};

export const AVAILABLE_ICON_NAMES = Object.keys(CATEGORY_ICONS);

export const CATEGORY_COLORS = [
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#3b82f6", // Blue
  "#6366f1", // Indigo
  "#8b5cf6", // Violet
  "#ec4899", // Pink
  "#14b8a6", // Teal
  "#ef4444", // Red
  "#22c55e", // Green
  "#64748b", // Slate
];

export function CategoryIcon({
  name,
  className = "w-4 h-4",
}: {
  name: string;
  className?: string;
}) {
  const Icon = CATEGORY_ICONS[name] || ShoppingCart;
  return <Icon className={className} />;
}
