import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Platform,
    ScrollView,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { Text } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";

type Formato = {
  id: string;
  tipo: "audio" | "video";
  bitrate?: number;
  resolucao?: number;
  ext?: string;
  size?: number;
};

type ApiInfoResponse = {
  title: string;
  formatos: Formato[];
  aviso?: string;
  erro?: string;
};

const formatarTamanho = (bytes: number) => {
  if (!bytes) return "";
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
};

const extra = (Constants.expoConfig?.extra ?? {}) as { publicApiBase?: string };
const API_PUBLICA_PADRAO =
  typeof extra.publicApiBase === "string" ? extra.publicApiBase.trim() : "";

const API_PADRAO =
  API_PUBLICA_PADRAO ||
  (Platform.OS === "android"
    ? "http://10.0.2.2:5000"
    : "http://localhost:5000");

const normalizarApiBase = (valor: string) => {
  const trimmed = valor.trim();
  // Remove barra no final para evitar //info e //download
  return trimmed.replace(/\/+$/, "");
};

// ─── ECG Waveform ─────────────────────────────────────────────────────────────
// Padrão de Y values (0 = topo, ECG_H = base) que imita um batimento cardíaco
const ECG_Y = [
  20, 20, 20, 20, 20, 20, 20, 20, 20, 18, 14, 4, 36, 20, 23, 20, 20, 20, 20, 20,
];
const N_VISIBLE = 38;
const STEP = 5;
const ECG_W = (N_VISIBLE - 1) * STEP;
const ECG_H = 40;

function EcgWaveform({ ativo }: { ativo: boolean }) {
  const [offset, setOffset] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!ativo) {
      setOffset(0);
      return;
    }
    timerRef.current = setInterval(
      () => setOffset((o) => (o + 1) % ECG_Y.length),
      70,
    );
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [ativo]);

  const yValues = Array.from({ length: N_VISIBLE }, (_, i) =>
    ativo ? ECG_Y[(offset + i) % ECG_Y.length] : ECG_H / 2,
  );

  const color = ativo ? "#00e676" : "#444";

  return (
    <View style={{ width: ECG_W, height: ECG_H, position: "relative" }}>
      {yValues.slice(0, -1).map((y1, i) => {
        const y2 = yValues[i + 1];
        const dy = y2 - y1;
        const length = Math.sqrt(STEP * STEP + dy * dy);
        const angle = Math.atan2(dy, STEP);
        const midX = i * STEP + STEP / 2;
        const midY = (y1 + y2) / 2;
        return (
          <View
            key={i}
            style={{
              position: "absolute",
              width: length,
              height: 2,
              backgroundColor: color,
              left: midX - length / 2,
              top: midY - 1,
              transform: [{ rotate: `${angle}rad` }],
            }}
          />
        );
      })}
    </View>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

export default function Downloader() {
  const isExpoGo = Constants.appOwnership === "expo";

  const [url, setUrl] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [formatos, setFormatos] = useState<Formato[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [tituloVideo, setTituloVideo] = useState<string>("");
  const [pastaDestinoUri, setPastaDestinoUri] = useState<string | null>(null);
  const [apiBaseInput, setApiBaseInput] = useState<string>(API_PADRAO);
  const [etapa, setEtapa] = useState<"idle" | "buscando" | "baixando">("idle");
  const [apiStatus, setApiStatus] = useState<"checking" | "online" | "offline">(
    "checking",
  );

  const apiBase = normalizarApiBase(apiBaseInput);

  const onChangeApiBase = (texto: string) => {
    setApiBaseInput(texto);
    setApiStatus(texto.trim() ? "checking" : "offline");
  };

  const verificarApi = useCallback(async (base: string) => {
    if (!base) {
      setApiStatus("offline");
      return;
    }
    setApiStatus("checking");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    try {
      const resp = await fetch(`${base}/`, {
        method: "GET",
        signal: controller.signal,
      });
      setApiStatus(resp.ok ? "online" : "offline");
    } catch {
      setApiStatus("offline");
    } finally {
      clearTimeout(timeoutId);
    }
  }, []);

  // Debounce 1.5s após parar de digitar
  useEffect(() => {
    const base = apiBase;
    const t = setTimeout(() => verificarApi(base), 1500);
    return () => clearTimeout(t);
  }, [apiBase, verificarApi]);

  // Polling a cada 10s
  useEffect(() => {
    const t = setInterval(() => verificarApi(apiBase), 10_000);
    return () => clearInterval(t);
  }, [apiBase, verificarApi]);

  const pedirPermissao = async (): Promise<boolean> => {
    // writeOnly=true: pede apenas permissão para salvar, evitando leitura de AUDIO
    // que no Expo Go pode falhar por limitações de manifesto.
    const { status } = await MediaLibrary.requestPermissionsAsync(true);
    if (status !== "granted") {
      Alert.alert("Permissão negada", "Permissão de armazenamento necessária.");
      return false;
    }
    return true;
  };

  const selecionarPastaAndroid = async () => {
    if (Platform.OS !== "android") return;

    try {
      const permissions =
        await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();

      if (!permissions.granted || !permissions.directoryUri) {
        Alert.alert("Pasta não selecionada", "Nenhuma pasta foi escolhida.");
        return;
      }

      setPastaDestinoUri(permissions.directoryUri);
      Alert.alert(
        "Pasta definida",
        "Os próximos downloads irão para a pasta escolhida.",
      );
    } catch (err: any) {
      console.error("[Downloader] ERRO ao selecionar pasta:", err);
      Alert.alert(
        "Erro",
        err?.message || "Não foi possível selecionar a pasta.",
      );
    }
  };

  const buscarFormatos = async () => {
    if (!url.trim()) {
      Alert.alert("Atenção", "Cole o link do YouTube antes de buscar.");
      return;
    }

    if (!apiBase) {
      Alert.alert("Atenção", "Informe a URL da API Python antes de buscar.");
      return;
    }

    try {
      setCarregando(true);
      setEtapa("buscando");
      setErro(null);
      setAviso(null);
      setFormatos([]);
      setTituloVideo("");

      const endpoint = `${apiBase}/info?url=${encodeURIComponent(url)}`;
      console.log("[Downloader] Chamando API:", endpoint);

      const response = await fetch(endpoint);
      const data: ApiInfoResponse = await response.json();

      if (!response.ok) {
        throw new Error(data?.erro || `Erro HTTP ${response.status}`);
      }

      if (!data?.formatos?.length) {
        setErro("Nenhum formato encontrado para essa URL.");
        return;
      }

      setTituloVideo(data.title || "Sem título");
      setFormatos(data.formatos);
      if (data.aviso) setAviso(data.aviso);

      console.log("[Downloader] Título:", data.title);
      console.log("[Downloader] Formatos recebidos:", data.formatos.length);
    } catch (err: any) {
      console.error("[Downloader] ERRO ao buscar formatos:", err);
      console.error("[Downloader] Mensagem:", err?.message);
      const msg = err?.message || "Erro ao consultar API local.";
      setErro(msg);
    } finally {
      setCarregando(false);
      setEtapa("idle");
    }
  };

  const baixarFormato = async (formato: Formato) => {
    if (!apiBase) {
      Alert.alert("Atenção", "Informe a URL da API Python antes de baixar.");
      return;
    }

    const vaiSalvarEmPastaEscolhida =
      Platform.OS === "android" && !!pastaDestinoUri;
    if (!vaiSalvarEmPastaEscolhida && !(await pedirPermissao())) return;

    setCarregando(true);
    setEtapa("baixando");
    setProgresso(3);

    try {
      const ext = formato.ext || (formato.tipo === "video" ? "mp4" : "m4a");
      const nomeBase = tituloVideo
        ? tituloVideo
            .replace(/[^\w\s\-_.]/g, "")
            .trim()
            .replace(/\s+/g, "_") || `media_${Date.now()}`
        : `media_${Date.now()}`;
      const caminhoTemp = `${FileSystem.cacheDirectory}${nomeBase}.${ext}`;
      const downloadUrl = `${apiBase}/download/${formato.id}`;

      console.log("[Downloader] Baixando via proxy:", downloadUrl);

      // Fallback visual: se o servidor não informar tamanho total,
      // mantemos uma barra "andando" para evitar sensação de travamento.
      let totalConhecido = false;
      const fakeProgressTimer = setInterval(() => {
        if (!totalConhecido) {
          setProgresso((p) => (p < 90 ? p + 2 : p));
        }
      }, 500);

      const download = FileSystem.createDownloadResumable(
        downloadUrl,
        caminhoTemp,
        {},
        (snap) => {
          if (snap.totalBytesExpectedToWrite > 0) {
            totalConhecido = true;
            const pct = Math.round(
              (snap.totalBytesWritten / snap.totalBytesExpectedToWrite) * 100,
            );
            setProgresso(pct);
          }
        },
      );

      const resultado = await download.downloadAsync();
      clearInterval(fakeProgressTimer);
      if (!resultado?.uri) throw new Error("Download falhou.");

      setProgresso(100);

      const nomeArquivo = `${nomeBase}.${ext}`;

      // Vídeos: NUNCA usar Base64 (causa OutOfMemoryError para arquivos grandes).
      // Sempre salva via MediaLibrary ou mostra o caminho do cache.
      if (formato.tipo === "video") {
        if (isExpoGo) {
          Alert.alert(
            "Vídeo baixado",
            `Arquivo salvo no cache do app:\n${resultado.uri}\n\nPara salvar na galeria, use Development Build.`,
          );
        } else {
          await MediaLibrary.saveToLibraryAsync(resultado.uri);
          Alert.alert("Concluído!", `Vídeo "${nomeArquivo}" salvo na galeria.`);
        }
      } else if (vaiSalvarEmPastaEscolhida && pastaDestinoUri) {
        // Áudio → SAF com Base64 (arquivos pequenos, seguro)
        const mimeType =
          ext === "mp3"
            ? "audio/mpeg"
            : ext === "m4a"
              ? "audio/mp4"
              : "audio/*";

        const arquivoDestinoUri =
          await FileSystem.StorageAccessFramework.createFileAsync(
            pastaDestinoUri,
            nomeArquivo,
            mimeType,
          );

        const base64 = await FileSystem.readAsStringAsync(resultado.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });

        await FileSystem.writeAsStringAsync(arquivoDestinoUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });

        Alert.alert(
          "Concluído!",
          `Áudio salvo na pasta escolhida.\n\nArquivo: ${nomeArquivo}`,
        );
      } else if (isExpoGo) {
        Alert.alert(
          "Áudio baixado",
          `Arquivo salvo em:\n${resultado.uri}\n\nPara salvar na galeria, use Development Build.`,
        );
      } else {
        await MediaLibrary.saveToLibraryAsync(resultado.uri);
        Alert.alert(
          "Concluído!",
          `Áudio "${nomeArquivo}" salvo na biblioteca.`,
        );
      }

      // Pequeno atraso para o usuário perceber o 100%
      await new Promise((resolve) => setTimeout(resolve, 250));
      setProgresso(0);
    } catch (err: any) {
      console.error("[Downloader] ERRO no download:", err);
      Alert.alert("Erro no download", err?.message || "Tente novamente.");
    } finally {
      setCarregando(false);
      setEtapa("idle");
    }
  };

  const formatosAudio = formatos.filter((f) => f.tipo === "audio");
  const formatosVideo = formatos.filter((f) => f.tipo === "video");

  return (
    <SafeAreaView style={styles.seguro}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Config da API */}
        <TextInput
          style={styles.input}
          placeholder="URL da API (ex: http://192.168.0.10:5000)"
          placeholderTextColor="#555"
          value={apiBaseInput}
          onChangeText={onChangeApiBase}
          editable={!carregando}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {/* Indicador de status da API */}
        <View style={styles.apiStatusContainer}>
          {apiStatus === "online" ? (
            <>
              <EcgWaveform ativo={true} />
              <Text style={styles.apiStatusOnline}>API online</Text>
            </>
          ) : apiStatus === "offline" ? (
            <>
              <EcgWaveform ativo={false} />
              <Text style={styles.apiStatusOffline}>
                A API informada não está ativa ou não existe.
              </Text>
            </>
          ) : (
            <>
              <EcgWaveform ativo={true} />
              <Text style={styles.apiStatusChecking}>Verificando API...</Text>
            </>
          )}
        </View>

        {Platform.OS === "android" && (
          <TouchableOpacity
            style={[
              styles.botaoSecundario,
              pastaDestinoUri ? styles.botaoSecundarioOk : null,
            ]}
            onPress={selecionarPastaAndroid}
            disabled={carregando}
          >
            <Text style={styles.botaoSecundarioTexto}>
              {pastaDestinoUri
                ? "✓ Pasta selecionada"
                : "📁 Selecionar pasta de destino"}
            </Text>
          </TouchableOpacity>
        )}

        {/* URL do YouTube */}
        <TextInput
          style={[styles.input, { marginTop: 8 }]}
          placeholder="Cole o link do YouTube aqui..."
          placeholderTextColor="#555"
          value={url}
          onChangeText={setUrl}
          editable={!carregando}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TouchableOpacity
          style={[styles.botao, carregando && styles.botaoDesabilitado]}
          onPress={buscarFormatos}
          disabled={carregando}
        >
          {etapa === "buscando" ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.botaoTexto}>Buscar formatos</Text>
          )}
        </TouchableOpacity>

        {/* Erro */}
        {erro && (
          <View style={styles.erroContainer}>
            <Text style={styles.erroTexto}>⚠ {erro}</Text>
          </View>
        )}

        {/* Aviso ffmpeg */}
        {aviso && (
          <View style={styles.avisoContainer}>
            <Text style={styles.avisoTexto}>ℹ {aviso}</Text>
          </View>
        )}

        {/* Barra de progresso */}
        {etapa === "baixando" && (
          <View style={styles.progressoContainer}>
            <Text style={styles.progressoTexto}>
              {progresso > 0
                ? `Baixando: ${progresso}%`
                : "Iniciando download..."}
            </Text>
            <View style={styles.barraFundo}>
              <View
                style={[
                  styles.barraPreenchida,
                  { width: `${Math.max(progresso, 12)}%` as any },
                ]}
              />
            </View>
          </View>
        )}

        {/* Título do vídeo */}
        {tituloVideo ? (
          <Text style={styles.tituloVideo} numberOfLines={2}>
            {tituloVideo}
          </Text>
        ) : null}

        {/* Seção Áudio */}
        {formatosAudio.length > 0 && (
          <View style={styles.secao}>
            <Text style={styles.secaoTitulo}>🎵 Áudio</Text>
            {formatosAudio.map((fmt, i) => (
              <TouchableOpacity
                key={i}
                style={styles.itemFormato}
                onPress={() => baixarFormato(fmt)}
                disabled={carregando}
              >
                <View>
                  <Text style={styles.itemPrincipal}>
                    {fmt.bitrate
                      ? `${fmt.bitrate} kbps`
                      : "Bitrate desconhecido"}
                  </Text>
                  <Text style={styles.itemDetalhe}>
                    {(fmt.ext || "").toUpperCase()}
                    {fmt.size ? ` • ${formatarTamanho(fmt.size)}` : ""}
                  </Text>
                </View>
                <Text style={styles.baixarTexto}>⬇ Baixar</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Seção Vídeo */}
        {formatosVideo.length > 0 && (
          <View style={styles.secao}>
            <Text style={styles.secaoTitulo}>🎬 Vídeo</Text>
            {formatosVideo.map((fmt, i) => (
              <TouchableOpacity
                key={i}
                style={styles.itemFormato}
                onPress={() => baixarFormato(fmt)}
                disabled={carregando}
              >
                <View>
                  <Text style={styles.itemPrincipal}>
                    {fmt.resolucao
                      ? `${fmt.resolucao}p`
                      : "Resolução desconhecida"}
                  </Text>
                  <Text style={styles.itemDetalhe}>
                    {(fmt.ext || "").toUpperCase()}
                    {fmt.size ? ` • ${formatarTamanho(fmt.size)}` : ""}
                  </Text>
                </View>
                <Text style={styles.baixarTexto}>⬇ Baixar</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  seguro: {
    flex: 1,
    backgroundColor: "#0f0f0f",
  },
  scroll: {
    flexGrow: 1,
    padding: 16,
    backgroundColor: "#0f0f0f",
  },
  input: {
    backgroundColor: "#1e1e1e",
    padding: 14,
    borderRadius: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: "#2e2e2e",
    marginBottom: 6,
    color: "#fff",
  },
  dicaPequena: {
    fontSize: 11,
    color: "#555",
    marginBottom: 12,
    textAlign: "center",
  },
  apiStatusContainer: {
    alignItems: "center",
    marginBottom: 14,
    gap: 4,
  },
  apiStatusOnline: {
    fontSize: 11,
    color: "#00e676",
    fontWeight: "600",
  },
  apiStatusOffline: {
    fontSize: 12,
    color: "#ff5252",
    textAlign: "center",
    paddingHorizontal: 8,
  },
  apiStatusChecking: {
    fontSize: 11,
    color: "#888",
  },
  botao: {
    backgroundColor: "#FF0000",
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 12,
  },
  botaoDesabilitado: {
    backgroundColor: "#444",
  },
  botaoTexto: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "bold",
  },
  botaoSecundario: {
    backgroundColor: "#1f3a5c",
    padding: 12,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 8,
  },
  botaoSecundarioOk: {
    backgroundColor: "#1a4a2e",
  },
  botaoSecundarioTexto: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  erroContainer: {
    backgroundColor: "#2a0000",
    borderWidth: 1,
    borderColor: "#7f0000",
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  erroTexto: {
    color: "#ff6b6b",
    fontWeight: "bold",
    fontSize: 14,
  },
  avisoContainer: {
    backgroundColor: "#1a1a00",
    borderWidth: 1,
    borderColor: "#555500",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  avisoTexto: {
    color: "#cccc00",
    fontSize: 13,
  },
  progressoContainer: {
    backgroundColor: "#1e1e1e",
    padding: 14,
    borderRadius: 10,
    marginBottom: 12,
  },
  progressoTexto: {
    color: "#aaa",
    marginBottom: 6,
    fontSize: 13,
  },
  barraFundo: {
    height: 8,
    backgroundColor: "#333",
    borderRadius: 4,
    overflow: "hidden",
  },
  barraPreenchida: {
    height: 8,
    backgroundColor: "#FF0000",
    borderRadius: 4,
  },
  tituloVideo: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 14,
    padding: 12,
    backgroundColor: "#1e1e1e",
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#FF0000",
  },
  secao: {
    marginBottom: 16,
  },
  secaoTitulo: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
  },
  itemFormato: {
    backgroundColor: "#1e1e1e",
    padding: 14,
    borderRadius: 10,
    marginBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  itemPrincipal: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
  itemDetalhe: {
    fontSize: 12,
    color: "#777",
    marginTop: 2,
  },
  baixarTexto: {
    fontSize: 13,
    color: "#ff4444",
    fontWeight: "bold",
  },
});
