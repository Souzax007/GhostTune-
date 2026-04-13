import Downloader from "@/components/downloader";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import React, { useState } from "react";
import { View } from "react-native";
import { BottomNavigation, Text } from "react-native-paper";

type RouteItem = {
  key: "home" | "settings" | "download";
  title: string;
  icon: string;
};

const routes: RouteItem[] = [
  { key: "home", title: "Home", icon: "home" },
  { key: "download", title: "Download", icon: "download" },
  { key: "settings", title: "Settings", icon: "cog" },
];

const renderScene = ({ route }: { route: RouteItem }) => {
  switch (route.key) {
    case "home":
      return (
        <View
          style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
        >
          <Text>Home!</Text>
        </View>
      );
    case "download":
      // Tela do downloader de áudio
      return <Downloader />;
    case "settings":
      return (
        <View
          style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
        >
          <Text>Settings!</Text>
        </View>
      );
    default:
      return null;
  }
};

export default function MyComponent() {
  const [index, setIndex] = useState(0);

  return (
    <View style={{ flex: 1 }}>
      {renderScene({ route: routes[index] })}
      <BottomNavigation.Bar
        navigationState={{ index, routes }}
        onTabPress={({ route }) => {
          const newIndex = routes.findIndex((r) => r.key === route.key);
          if (newIndex !== -1) setIndex(newIndex);
        }}
        renderIcon={({ route, color }) => (
          <MaterialCommunityIcons
            name={route.icon as any}
            size={24}
            color={color}
          />
        )}
        getLabelText={({ route }) => route.title}
      />
    </View>
  );
}
