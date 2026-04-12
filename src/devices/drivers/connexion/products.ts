import type { DeviceInfo } from "../../types.js";

export type DeviceFamily = "spacemouse" | "orbion" | "cadmouse" | "spacefox" | "unknown";

export interface ProductInfo {
  model: string;
  family: DeviceFamily;
  connectionType: "usb" | "wireless" | "bluetooth";
  axes: number; // number of spatial axes (6 for SpaceMouse, 1 for Orbion, 0 for CadMouse)
}

/** 3Dconnexion product ID → device info (vendor ID 0x046d) */
export const CONNEXION_PRODUCTS: Record<number, ProductInfo> = {
  // SpaceMouse family — 6DOF
  0xc603: { model: "SpaceMouse Plus XT", family: "spacemouse", connectionType: "usb", axes: 6 },
  0xc605: { model: "CADMan", family: "spacemouse", connectionType: "usb", axes: 6 },
  0xc606: { model: "SpaceMouse Classic", family: "spacemouse", connectionType: "usb", axes: 6 },
  0xc621: { model: "SpaceBall 5000", family: "spacemouse", connectionType: "usb", axes: 6 },
  0xc623: { model: "SpaceTraveler", family: "spacemouse", connectionType: "usb", axes: 6 },
  0xc625: { model: "SpacePilot", family: "spacemouse", connectionType: "usb", axes: 6 },
  0xc626: { model: "SpaceNavigator", family: "spacemouse", connectionType: "usb", axes: 6 },
  0xc627: { model: "SpaceExplorer", family: "spacemouse", connectionType: "usb", axes: 6 },
  0xc628: { model: "SpaceNavigator for Notebooks", family: "spacemouse", connectionType: "usb", axes: 6 },
  0xc629: { model: "SpacePilot Pro", family: "spacemouse", connectionType: "usb", axes: 6 },
  0xc62b: { model: "SpaceMouse Pro", family: "spacemouse", connectionType: "usb", axes: 6 },
  0xc62e: { model: "SpaceMouse Wireless (cabled)", family: "spacemouse", connectionType: "usb", axes: 6 },
  0xc62f: { model: "SpaceMouse Wireless Receiver", family: "spacemouse", connectionType: "wireless", axes: 6 },
  0xc631: { model: "SpaceMouse Pro Wireless (cabled)", family: "spacemouse", connectionType: "usb", axes: 6 },
  0xc632: { model: "SpaceMouse Pro Wireless Receiver", family: "spacemouse", connectionType: "wireless", axes: 6 },
  0xc633: { model: "SpaceMouse Enterprise", family: "spacemouse", connectionType: "usb", axes: 6 },
  0xc635: { model: "SpaceMouse Compact", family: "spacemouse", connectionType: "usb", axes: 6 },
  0xc636: { model: "SpaceMouse Module", family: "spacemouse", connectionType: "usb", axes: 6 },
  0xc640: { model: "SpaceMouse Enterprise 2", family: "spacemouse", connectionType: "usb", axes: 6 },

  // SpaceFox — 6DOF (compact form factor)
  0xc650: { model: "SpaceFox", family: "spacefox", connectionType: "usb", axes: 6 },
  0xc651: { model: "SpaceFox Wireless Receiver", family: "spacefox", connectionType: "wireless", axes: 6 },

  // Orbion — rotary dial (1 axis + haptic)
  0xc654: { model: "Orbion", family: "orbion", connectionType: "wireless", axes: 1 },

  // CadMouse — precision mouse with extra buttons
  0xc641: { model: "CadMouse Pro", family: "cadmouse", connectionType: "usb", axes: 0 },
  0xc642: { model: "CadMouse Compact", family: "cadmouse", connectionType: "usb", axes: 0 },
  0xc643: { model: "CadMouse Pro Wireless (cabled)", family: "cadmouse", connectionType: "usb", axes: 0 },
  0xc644: { model: "CadMouse Pro Wireless Receiver", family: "cadmouse", connectionType: "wireless", axes: 0 },
  0xc645: { model: "CadMouse Compact Wireless (cabled)", family: "cadmouse", connectionType: "usb", axes: 0 },
  0xc646: { model: "CadMouse Compact Wireless Receiver", family: "cadmouse", connectionType: "wireless", axes: 0 },

  // Universal receiver (handles multiple devices)
  0xc652: { model: "Universal Receiver", family: "unknown", connectionType: "wireless", axes: 0 },
};

export const CONNEXION_VENDOR_ID = 0x046d;

export function lookupProduct(productId: number): ProductInfo {
  return CONNEXION_PRODUCTS[productId] ?? {
    model: `Unknown (0x${productId.toString(16)})`,
    family: "unknown" as DeviceFamily,
    connectionType: "unknown" as const,
    axes: 0,
  };
}

export function buildDeviceInfo(productId: number, deviceId: string): DeviceInfo {
  const product = lookupProduct(productId);
  const axes = product.axes === 6 ? ["tx", "ty", "tz", "rx", "ry", "rz"]
    : product.axes === 1 ? ["rz"]
    : [];
  return {
    id: deviceId,
    name: product.model,
    model: product.model,
    vendor: "3Dconnexion",
    vendorId: CONNEXION_VENDOR_ID,
    productId,
    connectionType: product.connectionType,
    axes,
    buttonCount: 32, // 3Dconnexion devices report up to 32 buttons
  };
}
