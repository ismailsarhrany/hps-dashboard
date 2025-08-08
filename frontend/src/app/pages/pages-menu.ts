import { NbMenuItem } from "@nebular/theme";

export const MENU_ITEMS: NbMenuItem[] = [
    {
    title: 'Configuration',
    group: true,
  },
  {
    title: 'Server Management',
    icon: 'settings-outline',
    link: '/pages/server-configuration',
  },
  {
    title: 'Oracle Monitoring',
    icon: 'database-outline',
    link: '/pages/oracle',
  },
  {
    title: 'Monitoring',
    group: true,
  },
  {
    title: 'Real-time',
    icon: 'activity-outline',
    link: '/pages/realtime',
  },
  {
    title: "Historic Dashboard",
    icon: "clock-outline",
    link: "/pages/historic",
  },
  {
    title: 'Processes',
    icon: 'list-outline',
    link: '/pages/process',
  },
  // {
  //   title: 'Prediction',
  //   icon: 'trending-up-outline',
  //   link: '/pages/prediction',
  // },
  {
    title: 'Anomaly Detection',
    icon: 'alert-triangle-outline',
    link: '/pages/anomaly',
  }
];