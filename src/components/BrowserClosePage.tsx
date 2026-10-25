import { toaster } from "@decky/api";
import { FC, useEffect } from "react";
import { closeAllTabs } from "../browserTabs";
import { closeNotesPage } from "../opening";
import { lastPlaceAddress, placePath, rememberAddress, WEB_ROUTE } from "../state/place";

// The Steam menu's "Close browser": closes every tab, then goes back to where you were (the game, or the page
// before Desk of Madness). It only passes through; nothing shows.

export const BrowserClosePage: FC = () => {
  useEffect(() => {
    closeAllTabs();
    // The Desk of Madness entry would otherwise open the browser again, on a fresh tab.
    if (lastPlaceAddress()?.startsWith(WEB_ROUTE)) rememberAddress(placePath());
    toaster.toast({ title: "Desk of Madness", body: "Browser closed", duration: 2000 });
    closeNotesPage();
  }, []);
  return null;
};
