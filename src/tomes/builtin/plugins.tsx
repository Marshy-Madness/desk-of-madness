import { FolderTome } from "../../pluginFolders/FolderList";
import { registerTome } from "../registry";

// Decky's plugins in folders of your own (the same folders can replace Decky's flat list; see pluginFolders/).

registerTome({
  id: "pluginFolders",
  name: "Plugin Folders",
  icon: "📂",
  category: "deck",
  description: "Your Decky plugins in folders; open one straight from the Desk. Can tidy Decky's own list too.",
  defaultOn: false,
  needsGame: false,
  component: ({ fullScreen }) => <FolderTome fullScreen={fullScreen} />,
});
