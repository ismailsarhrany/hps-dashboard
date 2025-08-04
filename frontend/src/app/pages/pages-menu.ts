import { NbMenuItem } from "@nebular/theme";

export const MENU_ITEMS: NbMenuItem[] = [
  {
    title: "Realtime Dashboard",
    icon: "activity-outline",
    link: "/pages/realtime",
    home: true,
  },
  {
    title: "Historic Dashboard",
    icon: "clock-outline",
    link: "/pages/historic",
  },
  {
    title: "Process Dashboard",
    icon: "settings-2-outline",
    link: "/pages/process",
  },
  {
    title: "Prediction Dashboard",
    icon: "trending-up-outline",
    link: "/pages/prediction",
  },
  {
    title: "Anomaly Dashboard",
    icon: "alert-triangle-outline",
    link: "/pages/anomaly",
  },
];