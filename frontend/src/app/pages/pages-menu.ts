import { NbMenuItem } from "@nebular/theme";

export const MENU_ITEMS: NbMenuItem[] = [

  {
    title: "Server Details",
    icon: "file-text-outline",
    link: "/pages/server-details",
    home: true,
    children: [
        {
    title: "Realtime Dashboard",
    icon: "activity-outline", // symbolizes live activity/metrics
    link: "/pages/realtime",
    home: true,
  },
  {
    title: "Historic Dashboard",
    icon: "clock-outline", // fits for past/historical data
    link: "/pages/historic",
    home: true,
  },
  {
    title: "Process Dashboard",
    icon: "settings-2-outline", // better for detailed or nested settings
    link: "/pages/process",
    home: true,
  },

    ]
  },


  {
    title: "Prediction Dashboard",
    icon: "trending-up-outline", // great for forecasting/predictions
    link: "/pages/prediction",
    home: true,
  },
  {
    title: "Anomaly Dashboard",
    icon: "alert-triangle-outline",
    link: "/pages/anomaly",
    home: true,
  },
];
