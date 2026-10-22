# Warranty Drawer

A mobile app for keeping track of appliance warranties, so you never miss the last day to make a claim.

Add an appliance once with when and where you bought it and how long its warranty lasts. Warranty Drawer works out when the coverage ends, reminds you before it does, and keeps the receipt, manual and serial number in one place for when something breaks.

## Features

- **Warranty tracking:** add, edit and delete appliances with the store, purchase date (native date picker) and warranty length. The list is sorted by which warranty ends first.
- **Status at a glance:** each item shows how many days or months are left, color-coded from "plenty of time" to "ending soon" to "expired".
- **Reminders:** local notifications go out a set number of days before the warranty ends (7, 14, 30 or 60) and again on the last day. They're rescheduled automatically when you edit an item.
- **Calendar integration:** add an all-day "warranty ends" event, with an alert and the item's details, to the phone's calendar. The event stays in sync when you edit or delete the item.
- **Receipts and manuals:** take photos or pick them from your library and tag them as Receipt, Manual or Other. Photos are copied into the app's own storage, so they're kept even if you delete them from your camera roll.
- **Product details:** model number, serial number, support phone (tap to call) and free-form notes for extended plans or claim history.
- **Works offline:** everything is stored on the device. No account or server is needed.

## Tech stack

- [React Native](https://reactnative.dev/) + [Expo](https://expo.dev/) (SDK 57), written in **TypeScript**
- **Expo Router** for file-based navigation with native tabs
- `AsyncStorage` for saving data on the device
- `expo-notifications` for scheduled reminders
- `expo-calendar` for calendar events
- `expo-image-picker` + `expo-file-system` for capturing and storing photos
- `@react-native-community/datetimepicker` for date entry

## Project structure

```
src/
  app/          screens (Expo Router: each file is a route)
    index.tsx   main warranty list, add/edit form and detail view
    _layout.tsx app layout and tabs
  components/   reusable UI components
  hooks/        theme and color-scheme hooks
  constants/    theme colors and fonts
assets/         app icon, splash screen and images
```

## Running it locally

You need [Node.js](https://nodejs.org/) and the [Expo Go](https://expo.dev/go) app on your phone (or an iOS simulator or Android emulator).

```bash
npm install
npx expo start
```

Scan the QR code with Expo Go (Android) or the Camera app (iOS) to open the app.

## Author

Built by **William Grubb** ([@willgrubb2025](https://github.com/willgrubb2025)), a software engineering student at Liberty University.

## License

[MIT](LICENSE)
