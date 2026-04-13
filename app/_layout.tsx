// _layout.tsx — Layout raiz da aplicação
// Este arquivo é obrigatório para o expo-router funcionar.
// Ele define a estrutura de navegação do app (quais telas existem).
// Pense nele como o "esqueleto" que envolve todas as telas.

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { PaperProvider } from "react-native-paper";

export default function RootLayout() {
  return (
    // PaperProvider: necessário para os componentes do react-native-paper funcionarem
    <PaperProvider>
      {/* Stack: gerencia a navegação entre telas (como um histórico de páginas) */}
      <Stack>
        {/* Registra a tela principal (app/index.tsx) sem cabeçalho */}
        <Stack.Screen name="index" options={{ headerShown: false }} />
      </Stack>

      {/* StatusBar: controla a barra de status do celular (hora, bateria, etc.) */}
      <StatusBar style="auto" />
    </PaperProvider>
  );
}
