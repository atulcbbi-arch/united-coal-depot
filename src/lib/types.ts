export type SaleType = "walkin" | "credit_delivery" | "prepaid_delivery";
export type PaymentMode = "cash" | "bank" | "credit";

export interface Item {
  id: string;
  name: string;
  baseRate: number;
  openingStock: number;
}

export interface Account {
  id: string;
  name: string;
  type: "cash" | "bank";
  openingBalance: number;
  balance: number;
}

export interface Party {
  id: string;
  name: string;
  phone: string;
  address: string;
  kind: "customer" | "supplier";
  creditDays: number;
  openingBalance: number; 
  currentBalance: number; 
  chase: boolean;
  lastOrderDate: string;
  customRates: Record<string, number>;
}

export interface BillLine {
  itemId: string;
  itemName: string;
  kg: number;
  rate: number;
  amount: number;
}

export interface Bill {
  id?: string;
  date: string;
  saleType: SaleType;
  partyId: string | null;
  customerName: string;
  phone: string;
  address: string;
  deliveryDate: string;
  deliveryTime: string;
  deliveryCharge: number;
  lines: BillLine[];
  total: number;
  accountId: string | null;
  paymentMethod: PaymentMode;
  deliveryStatus: "scheduled" | "delivered" | "canceled" | null;
  isPosted: boolean;
  notes: string;
}

export interface Purchase {
  id?: string;
  date: string;
  partyId: string;
  supplierName: string;
  itemId: string;
  itemName: string;
  kg: number;
  rate: number;
  total: number;
  accountId: string | null;
  paymentMethod: PaymentMode;
}

export interface MoneyEntry {
  id?: string;
  date: string;
  type: "payment_in" | "payment_out" | "expense" | "pdc_in";
  status?: "pending" | "cleared";
  clearanceDate?: string;
  chequeNumber?: string;
  partyId?: string | null;
  partyName?: string;
  accountId: string | null; 
  amount: number;
  notes: string;
}

export interface OverdueParty {
  party: Party;
  overdueAmount: number;
  daysOverdue: number;
}

export interface StockInsight {
  itemId: string;
  itemName: string;
  currentKg: number;
  status: "healthy" | "low_stock" | "dead_stock";
  soldLast30DaysKg: number;
}

export interface InactiveParty {
  party: Party;
  daysSinceLastOrder: number;
}