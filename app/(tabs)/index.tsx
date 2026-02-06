import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type Orientation = "portrait" | "landscape";
type PaperSize = "A4" | "Letter" | "Legal";
type SelectedImage = {
  uri: string;
  width: number;
  height: number;
  mimeType: string | null;
};

const PAPER_SIZES: Record<PaperSize, { widthMm: number; heightMm: number }> = {
  A4: { widthMm: 210, heightMm: 297 },
  Letter: { widthMm: 215.9, heightMm: 279.4 },
  Legal: { widthMm: 215.9, heightMm: 355.6 },
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const escapeAttribute = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

function getPageDimensionsMm(paperSize: PaperSize, orientation: Orientation) {
  const base = PAPER_SIZES[paperSize];
  return orientation === "portrait"
    ? { widthMm: base.widthMm, heightMm: base.heightMm }
    : { widthMm: base.heightMm, heightMm: base.widthMm };
}

function inferImageMimeType(image: SelectedImage): string {
  if (image.mimeType?.startsWith("image/")) {
    return image.mimeType;
  }

  const extension = image.uri.split("?")[0]?.split(".").pop()?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "heic" || extension === "heif") return "image/heic";

  return "image/jpeg";
}

export default function HomeScreen() {
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [paperSize, setPaperSize] = useState<PaperSize>("A4");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [marginMm, setMarginMm] = useState(10);
  const [isConverting, setIsConverting] = useState(false);
  const [pdfUri, setPdfUri] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);

  const { widthMm, heightMm } = useMemo(
    () => getPageDimensionsMm(paperSize, orientation),
    [paperSize, orientation],
  );

  const maxMarginMm = useMemo(
    () => Math.floor(Math.max(0, Math.min(widthMm, heightMm) / 2 - 1)),
    [heightMm, widthMm],
  );

  useEffect(() => {
    setMarginMm((current) => clamp(current, 0, maxMarginMm));
  }, [maxMarginMm]);

  const previewAspectRatio = useMemo(() => {
    const contentWidth = Math.max(widthMm - marginMm * 2, 1);
    const contentHeight = Math.max(heightMm - marginMm * 2, 1);
    return contentWidth / contentHeight;
  }, [heightMm, marginMm, widthMm]);

  const pickImages = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Permiso requerido",
        "Necesitamos permiso para acceder a tus fotos y convertirlas a PDF.",
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 1,
      selectionLimit: 0,
    });

    if (result.canceled || !result.assets?.length) return;

    setImages((previous) => {
      const existingUris = new Set(previous.map((item) => item.uri));
      const additions = result.assets
        .filter((asset) => !existingUris.has(asset.uri))
        .map((asset) => ({
          uri: asset.uri,
          width: asset.width ?? 0,
          height: asset.height ?? 0,
          mimeType: asset.mimeType ?? null,
        }));
      return [...previous, ...additions];
    });
  }, []);

  const removeImage = useCallback((uri: string) => {
    setImages((previous) => previous.filter((item) => item.uri !== uri));
  }, []);

  const buildPdfHtml = useCallback(
    (imageSources: string[]) => {
      const pages = imageSources
        .map(
          (source, index) => `
          <section class="sheet">
            <img src="${escapeAttribute(source)}" alt="Imagen ${index + 1}" />
          </section>
        `,
        )
        .join("");

      return `
      <!doctype html>
      <html lang="es">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>
            @page {
              size: ${widthMm}mm ${heightMm}mm;
              margin: 0;
            }

            html, body {
              margin: 0;
              padding: 0;
              background: #ffffff;
            }

            .sheet {
              box-sizing: border-box;
              width: ${widthMm}mm;
              height: ${heightMm}mm;
              padding: ${marginMm}mm;
              display: flex;
              align-items: center;
              justify-content: center;
              page-break-after: always;
              break-after: page;
            }

            .sheet:last-child {
              page-break-after: auto;
              break-after: auto;
            }

            .sheet img {
              width: 100%;
              height: 100%;
              object-fit: contain;
              display: block;
            }
          </style>
        </head>
        <body>
          ${pages}
        </body>
      </html>
    `;
    },
    [heightMm, marginMm, widthMm],
  );

  const convertToPdf = useCallback(async () => {
    if (!images.length) {
      Alert.alert(
        "Sin imágenes",
        "Selecciona al menos una imagen para convertir.",
      );
      return;
    }

    setIsConverting(true);
    try {
      const imageSources = await Promise.all(
        images.map(async (image) => {
          const base64 = await new File(image.uri).base64();
          const mimeType = inferImageMimeType(image);
          return `data:${mimeType};base64,${base64}`;
        }),
      );

      const html = buildPdfHtml(imageSources);
      const file = await Print.printToFileAsync({ html });
      setPdfUri(file.uri);
      Alert.alert("PDF creado", "Se generó correctamente el PDF.");
    } catch (error) {
      Alert.alert("Error", "No se pudo generar el PDF. Intenta nuevamente.");
      console.error(error);
    } finally {
      setIsConverting(false);
    }
  }, [buildPdfHtml, images.length]);

  const sharePdf = useCallback(async () => {
    if (!pdfUri) {
      Alert.alert("Sin PDF", "Primero genera un PDF.");
      return;
    }

    const available = await Sharing.isAvailableAsync();
    if (!available) {
      Alert.alert(
        "No disponible",
        "Compartir no está disponible en este dispositivo.",
      );
      return;
    }

    setIsSharing(true);
    try {
      await Sharing.shareAsync(pdfUri, {
        mimeType: "application/pdf",
        UTI: "com.adobe.pdf",
      });
    } finally {
      setIsSharing(false);
    }
  }, [pdfUri]);

  const renderImageItem = useCallback(
    ({ item, index }: { item: SelectedImage; index: number }) => (
      <View style={styles.imageRow}>
        <Image source={{ uri: item.uri }} style={styles.thumbnail} />
        <View style={styles.imageMeta}>
          <Text style={styles.imageLabel}>Página {index + 1}</Text>
          <Text style={styles.imageSub}>
            {item.width > 0 && item.height > 0
              ? `${item.width}x${item.height}`
              : "Sin dimensiones"}
          </Text>
        </View>
        <Pressable
          style={styles.removeButton}
          onPress={() => removeImage(item.uri)}
        >
          <Text style={styles.removeButtonText}>Quitar</Text>
        </Pressable>
      </View>
    ),
    [removeImage],
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlatList
        data={images}
        keyExtractor={(item) => item.uri}
        renderItem={renderImageItem}
        contentContainerStyle={styles.contentContainer}
        ListHeaderComponent={
          <View>
            <Text style={styles.title}>Convertir Imágenes a PDF</Text>
            <Text style={styles.subtitle}>
              Cada imagen será una página. La imagen se ajusta en modo contain
              respetando márgenes.
            </Text>

            <Pressable style={styles.primaryButton} onPress={pickImages}>
              <Text style={styles.primaryButtonText}>Seleccionar fotos</Text>
            </Pressable>

            <View style={styles.controlBlock}>
              <Text style={styles.controlTitle}>Paper size</Text>
              <View style={styles.optionRow}>
                {(["A4", "Letter", "Legal"] as const).map((option) => (
                  <Pressable
                    key={option}
                    onPress={() => setPaperSize(option)}
                    style={[
                      styles.optionButton,
                      paperSize === option && styles.optionButtonActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.optionButtonText,
                        paperSize === option && styles.optionButtonTextActive,
                      ]}
                    >
                      {option}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.controlBlock}>
              <Text style={styles.controlTitle}>Orientation</Text>
              <View style={styles.optionRow}>
                {(["portrait", "landscape"] as const).map((option) => (
                  <Pressable
                    key={option}
                    onPress={() => setOrientation(option)}
                    style={[
                      styles.optionButton,
                      orientation === option && styles.optionButtonActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.optionButtonText,
                        orientation === option && styles.optionButtonTextActive,
                      ]}
                    >
                      {option}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.controlBlock}>
              <Text style={styles.controlTitle}>Margin (mm)</Text>
              <View style={styles.marginRow}>
                <Pressable
                  onPress={() =>
                    setMarginMm((value) => clamp(value - 2, 0, maxMarginMm))
                  }
                  style={styles.marginControl}
                >
                  <Text style={styles.marginControlText}>-</Text>
                </Pressable>
                <TextInput
                  keyboardType="number-pad"
                  value={String(marginMm)}
                  onChangeText={(text) =>
                    setMarginMm(
                      clamp(
                        Number.parseInt(text || "0", 10) || 0,
                        0,
                        maxMarginMm,
                      ),
                    )
                  }
                  style={styles.marginInput}
                />
                <Pressable
                  onPress={() =>
                    setMarginMm((value) => clamp(value + 2, 0, maxMarginMm))
                  }
                  style={styles.marginControl}
                >
                  <Text style={styles.marginControlText}>+</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.previewCard}>
              <Text style={styles.previewTitle}>Vista previa de página</Text>
              <View
                style={[
                  styles.previewCanvas,
                  { aspectRatio: previewAspectRatio },
                ]}
              >
                {images[0]?.uri ? (
                  <Image
                    source={{ uri: images[0].uri }}
                    style={styles.previewImage}
                    resizeMode="contain"
                  />
                ) : (
                  <Text style={styles.previewEmpty}>
                    Selecciona imágenes para previsualizar
                  </Text>
                )}
              </View>
            </View>

            <View style={styles.actionsRow}>
              <Pressable
                style={[
                  styles.primaryButton,
                  (!images.length || isConverting) && styles.buttonDisabled,
                ]}
                onPress={convertToPdf}
                disabled={!images.length || isConverting}
              >
                {isConverting ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Generar PDF</Text>
                )}
              </Pressable>

              <Pressable
                style={[
                  styles.secondaryButton,
                  (!pdfUri || isSharing) && styles.buttonDisabled,
                ]}
                onPress={sharePdf}
                disabled={!pdfUri || isSharing}
              >
                {isSharing ? (
                  <ActivityIndicator color="#0f172a" />
                ) : (
                  <Text style={styles.secondaryButtonText}>Compartir PDF</Text>
                )}
              </Pressable>
            </View>
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            Aún no has seleccionado imágenes.
          </Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f4f6f8",
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingBottom: 40,
    paddingTop: 8,
    gap: 10,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: "#0f172a",
  },
  subtitle: {
    marginTop: 8,
    marginBottom: 16,
    fontSize: 14,
    color: "#475569",
  },
  primaryButton: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 15,
  },
  secondaryButton: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  secondaryButtonText: {
    color: "#0f172a",
    fontWeight: "600",
    fontSize: 15,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  controlBlock: {
    marginTop: 14,
  },
  controlTitle: {
    fontSize: 13,
    color: "#334155",
    marginBottom: 8,
    fontWeight: "600",
  },
  optionRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  optionButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#ffffff",
  },
  optionButtonActive: {
    borderColor: "#0f172a",
    backgroundColor: "#0f172a",
  },
  optionButtonText: {
    color: "#334155",
    fontWeight: "500",
  },
  optionButtonTextActive: {
    color: "#ffffff",
  },
  marginRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  marginControl: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  marginControlText: {
    fontSize: 22,
    color: "#0f172a",
    marginTop: -2,
  },
  marginInput: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    color: "#0f172a",
  },
  previewCard: {
    marginTop: 16,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
  },
  previewTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#334155",
    marginBottom: 10,
  },
  previewCanvas: {
    width: "100%",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#e2e8f0",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
  previewEmpty: {
    color: "#475569",
    fontSize: 13,
    padding: 16,
    textAlign: "center",
  },
  actionsRow: {
    marginTop: 16,
    gap: 10,
  },
  imageRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 10,
    gap: 10,
  },
  thumbnail: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: "#e2e8f0",
  },
  imageMeta: {
    flex: 1,
  },
  imageLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
  },
  imageSub: {
    marginTop: 2,
    fontSize: 12,
    color: "#64748b",
  },
  removeButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
  },
  removeButtonText: {
    color: "#334155",
    fontWeight: "500",
    fontSize: 13,
  },
  emptyText: {
    marginTop: 14,
    textAlign: "center",
    color: "#64748b",
    fontSize: 13,
  },
});
