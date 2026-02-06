import Ionicons from "@expo/vector-icons/Ionicons";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as Print from "expo-print";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import DraggableFlatList, {
  type RenderItemParams,
} from "react-native-draggable-flatlist";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

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

const COLORS = {
  bg: "#f3f4f6",
  surface: "#ffffff",
  surfaceAlt: "#f8fafc",
  stroke: "#dbe3ee",
  text: "#0f172a",
  textMuted: "#5b667a",
  primary: "#0f172a",
  primaryText: "#ffffff",
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const escapeAttribute = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

function mmToPrintPoints(mm: number): number {
  return Math.round((mm / 25.4) * 72);
}

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
  const [paddingMm, setPaddingMm] = useState(10);
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewCanvasSize, setPreviewCanvasSize] = useState({
    width: 0,
    height: 0,
  });

  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const { widthMm, heightMm } = useMemo(
    () => getPageDimensionsMm(paperSize, orientation),
    [orientation, paperSize],
  );

  const maxPaddingMm = useMemo(
    () => Math.floor(Math.max(0, Math.min(widthMm, heightMm) / 2 - 1)),
    [heightMm, widthMm],
  );

  const previewAspectRatio = useMemo(
    () => widthMm / heightMm,
    [heightMm, widthMm],
  );

  const previewContentSize = useMemo(
    () => ({
      width: Math.max(
        1,
        previewCanvasSize.width * Math.max(0, 1 - (paddingMm * 2) / widthMm),
      ),
      height: Math.max(
        1,
        previewCanvasSize.height * Math.max(0, 1 - (paddingMm * 2) / heightMm),
      ),
    }),
    [
      heightMm,
      paddingMm,
      previewCanvasSize.height,
      previewCanvasSize.width,
      widthMm,
    ],
  );

  const horizontalPadding = useMemo(() => {
    if (width >= 768) return 24;
    if (width >= 420) return 16;
    return 12;
  }, [width]);

  const contentMaxWidth = useMemo(() => {
    if (width >= 1024) return 860;
    if (width >= 768) return 720;
    return width;
  }, [width]);

  const listContentStyle = useMemo(
    () => ({
      paddingTop: Math.max(8, insets.top * 0.35),
      paddingBottom: Math.max(24, insets.bottom + 20),
      paddingHorizontal: horizontalPadding,
      alignSelf: "center" as const,
      width: "100%" as const,
      maxWidth: contentMaxWidth,
      gap: 12,
    }),
    [contentMaxWidth, horizontalPadding, insets.bottom, insets.top],
  );

  const onPreviewLayout = useCallback((event: LayoutChangeEvent) => {
    const { width: canvasWidth, height: canvasHeight } =
      event.nativeEvent.layout;
    setPreviewCanvasSize((current) => {
      if (current.width === canvasWidth && current.height === canvasHeight) {
        return current;
      }
      return { width: canvasWidth, height: canvasHeight };
    });
  }, []);

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
      mediaTypes: ["images"],
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

  const buildPdfHtml = useCallback(
    (imageSources: string[]) => {
      const contentWidthMm = Math.max(widthMm - paddingMm * 2, 1);
      const contentHeightMm = Math.max(heightMm - paddingMm * 2, 1);

      const pages = imageSources
        .map(
          (source, index) => `
          <section class="sheet ${orientation}">
            <div class="content">
              <img src="${escapeAttribute(source)}" alt="Imagen ${index + 1}" />
            </div>
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
              width: ${widthMm}mm;
              height: ${heightMm}mm;
              display: flex;
              align-items: center;
              justify-content: center;
              page-break-after: always;
              break-after: page;
              overflow: hidden;
            }

            .sheet:last-child {
              page-break-after: auto;
              break-after: auto;
            }

            .content {
              width: ${contentWidthMm}mm;
              height: ${contentHeightMm}mm;
              display: flex;
              align-items: center;
              justify-content: center;
            }

            .content img {
              max-width: 100%;
              max-height: 100%;
              width: auto;
              height: auto;
              display: block;
            }

            .sheet.landscape .content img {
              max-width: ${contentHeightMm}mm;
              max-height: ${contentWidthMm}mm;
              transform: rotate(90deg);
              transform-origin: center center;
            }
          </style>
        </head>
        <body>
          ${pages}
        </body>
      </html>
    `;
    },
    [heightMm, orientation, paddingMm, widthMm],
  );

  const generatePdf = useCallback(async () => {
    if (!images.length) {
      Alert.alert(
        "Sin imágenes",
        "Selecciona al menos una imagen para convertir.",
      );
      return;
    }

    setIsGenerating(true);
    try {
      const imageSources = await Promise.all(
        images.map(async (image) => {
          const base64 = await new File(image.uri).base64();
          const mimeType = inferImageMimeType(image);
          return `data:${mimeType};base64,${base64}`;
        }),
      );

      const html = buildPdfHtml(imageSources);
      await Print.printAsync({
        html,
        orientation: Print.Orientation[orientation],
      });
    } catch (error) {
      Alert.alert("Error", "No se pudo generar o compartir el PDF.");
      console.error(error);
    } finally {
      setIsGenerating(false);
    }
  }, [buildPdfHtml, heightMm, images, widthMm]);

  const renderImageItem = useCallback(
    ({ item, drag, isActive, getIndex }: RenderItemParams<SelectedImage>) => (
      <View style={[styles.pageRow, isActive && styles.pageRowDragging]}>
        <Pressable
          style={styles.dragHandle}
          onPressIn={drag}
          disabled={isActive}
        >
          <Ionicons
            name="reorder-three-outline"
            size={18}
            color={COLORS.textMuted}
          />
        </Pressable>

        <Image source={{ uri: item.uri }} style={styles.thumbnail} />

        <View style={styles.pageMeta}>
          <Text style={styles.pageTitle}>Página {(getIndex?.() ?? 0) + 1}</Text>
          <Text style={styles.pageSub}>
            {item.width > 0 && item.height > 0
              ? `${item.width} × ${item.height}`
              : "Sin dimensiones"}
          </Text>
        </View>

        <Pressable
          style={styles.removeButton}
          onPress={() =>
            setImages((previous) => previous.filter((p) => p.uri !== item.uri))
          }
        >
          <Ionicons name="trash-outline" size={18} color={COLORS.textMuted} />
        </Pressable>
      </View>
    ),
    [],
  );

  const infoSummary = `${paperSize} · ${orientation} · ${paddingMm}mm`;

  const previewImageStyle = useMemo(
    () => [
      styles.previewImage,
      orientation === "landscape" ? { transform: [{ rotate: "90deg" }] } : null,
    ],
    [orientation],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <DraggableFlatList
        data={images}
        keyExtractor={(item) => item.uri}
        renderItem={renderImageItem}
        onDragEnd={({ data }) => setImages(data)}
        contentContainerStyle={[styles.contentContainer, listContentStyle]}
        ListHeaderComponent={
          <View style={styles.headerStack}>
            <View style={styles.heroCard}>
              <View style={styles.heroTopRow}>
                <Text style={styles.heroTitle}>Imágenes a PDF</Text>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{images.length} pág.</Text>
                </View>
              </View>
              <Text style={styles.heroSubtitle}>
                Ordena tus fotos, ajusta formato de página y genera el PDF con
                una imagen por página.
              </Text>

              <Pressable style={styles.ctaButton} onPress={pickImages}>
                <Ionicons
                  name="images-outline"
                  size={18}
                  color={COLORS.primaryText}
                />
                <Text style={styles.ctaText}>Seleccionar fotos</Text>
              </Pressable>
            </View>

            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <Ionicons
                  name="options-outline"
                  size={17}
                  color={COLORS.text}
                />
                <Text style={styles.sectionTitle}>Ajustes de página</Text>
              </View>

              <Text style={styles.controlLabel}>Tamaño de página</Text>
              <View style={styles.chipRow}>
                {(["A4", "Letter", "Legal"] as const).map((option) => (
                  <Pressable
                    key={option}
                    onPress={() => setPaperSize(option)}
                    style={[
                      styles.chip,
                      paperSize === option && styles.chipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        paperSize === option && styles.chipTextActive,
                      ]}
                    >
                      {option}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.controlLabel}>Orientación</Text>
              <View style={styles.chipRow}>
                {(["portrait", "landscape"] as const).map((option) => (
                  <Pressable
                    key={option}
                    onPress={() => setOrientation(option)}
                    style={[
                      styles.chip,
                      orientation === option && styles.chipActive,
                    ]}
                  >
                    <Ionicons
                      name={
                        option === "portrait"
                          ? "phone-portrait-outline"
                          : "phone-landscape-outline"
                      }
                      size={14}
                      color={
                        orientation === option
                          ? COLORS.primaryText
                          : COLORS.textMuted
                      }
                    />
                    <Text
                      style={[
                        styles.chipText,
                        orientation === option && styles.chipTextActive,
                      ]}
                    >
                      {option}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.controlLabel}>Padding de página</Text>
              <View style={styles.paddingRow}>
                <Pressable
                  onPress={() =>
                    setPaddingMm((current) =>
                      clamp(current - 2, 0, maxPaddingMm),
                    )
                  }
                  style={styles.paddingButton}
                >
                  <Ionicons name="remove" size={20} color={COLORS.text} />
                </Pressable>

                <View style={styles.paddingValueBox}>
                  <Text style={styles.paddingValue}>{paddingMm} mm</Text>
                  <Text style={styles.paddingHint}>{infoSummary}</Text>
                </View>

                <Pressable
                  onPress={() =>
                    setPaddingMm((current) =>
                      clamp(current + 2, 0, maxPaddingMm),
                    )
                  }
                  style={styles.paddingButton}
                >
                  <Ionicons name="add" size={20} color={COLORS.text} />
                </Pressable>
              </View>
            </View>

            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <Ionicons name="scan-outline" size={17} color={COLORS.text} />
                <Text style={styles.sectionTitle}>Vista previa</Text>
              </View>

              <View
                style={[
                  styles.previewCanvas,
                  { aspectRatio: previewAspectRatio },
                ]}
                onLayout={onPreviewLayout}
              >
                <View style={[styles.previewContent, previewContentSize]}>
                  {images[0]?.uri ? (
                    <Image
                      source={{ uri: images[0].uri }}
                      style={previewImageStyle}
                      resizeMode="contain"
                    />
                  ) : (
                    <Text style={styles.previewEmpty}>
                      Selecciona imágenes para previsualizar
                    </Text>
                  )}
                </View>
              </View>
            </View>

            <Pressable
              style={[
                styles.downloadButton,
                (!images.length || isGenerating) &&
                  styles.downloadButtonDisabled,
              ]}
              onPress={generatePdf}
              disabled={!images.length || isGenerating}
            >
              {isGenerating ? (
                <ActivityIndicator color={COLORS.primaryText} />
              ) : (
                <>
                  <Ionicons
                    name="download-outline"
                    size={18}
                    color={COLORS.primaryText}
                  />
                  <Text style={styles.downloadButtonText}>Descargar PDF</Text>
                </>
              )}
            </Pressable>

            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <Ionicons name="list-outline" size={17} color={COLORS.text} />
                <Text style={styles.sectionTitle}>Orden de páginas</Text>
              </View>
              <Text style={styles.listHint}>
                Usa el icono de arrastre para reordenar las imágenes.
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyListCard}>
            <Ionicons
              name="images-outline"
              size={22}
              color={COLORS.textMuted}
            />
            <Text style={styles.emptyListText}>
              Aún no has seleccionado imágenes.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  contentContainer: {
    flexGrow: 1,
  },
  headerStack: {
    gap: 12,
    marginBottom: 12,
  },
  heroCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    padding: 16,
    gap: 12,
  },
  heroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: COLORS.text,
  },
  badge: {
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: COLORS.stroke,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.textMuted,
  },
  heroSubtitle: {
    color: COLORS.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  ctaButton: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  ctaText: {
    color: COLORS.primaryText,
    fontWeight: "600",
    fontSize: 15,
  },
  sectionCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    padding: 14,
    gap: 10,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.text,
  },
  controlLabel: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  chipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: "600",
  },
  chipTextActive: {
    color: COLORS.primaryText,
  },
  paddingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  paddingButton: {
    width: 44,
    height: 44,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    backgroundColor: COLORS.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  paddingValueBox: {
    flex: 1,
    minHeight: 44,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  paddingValue: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: "700",
  },
  paddingHint: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  previewCanvas: {
    width: "100%",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    backgroundColor: COLORS.surfaceAlt,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  previewContent: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
  previewEmpty: {
    color: COLORS.textMuted,
    fontSize: 13,
    textAlign: "center",
    paddingHorizontal: 12,
  },
  downloadButton: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    borderWidth: 1,
    borderColor: COLORS.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  downloadButtonDisabled: {
    opacity: 0.55,
  },
  downloadButtonText: {
    color: COLORS.primaryText,
    fontWeight: "700",
    fontSize: 15,
  },
  listHint: {
    color: COLORS.textMuted,
    fontSize: 13,
  },
  pageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    padding: 10,
    marginBottom: 8,
  },
  pageRowDragging: {
    borderColor: "#93a6bd",
    opacity: 0.9,
  },
  dragHandle: {
    width: 34,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: "#d8dee8",
  },
  pageMeta: {
    flex: 1,
  },
  pageTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: "700",
  },
  pageSub: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  removeButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyListCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    backgroundColor: COLORS.surface,
    minHeight: 76,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  emptyListText: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: "500",
  },
});
