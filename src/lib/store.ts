import { supabase } from "../supabase";
import { sendTelegramNotification } from "../telegram";
import { type Account, type Bill, type Item, type MoneyEntry, type Party, type Purchase, type OverdueParty, type StockInsight, type InactiveParty } from "./types";

export async function getSecurityPin(uid: string): Promise<string | null> {
  const { data } = await supabase.from("settings").select("pin").eq("id", "security").single();
  return data ? data.pin : null;
}

export async function saveSecurityPin(uid: string, pin: string) {
  await supabase.from("settings").upsert({ id: "security", pin });
}

export async function listAccounts(uid: string): Promise<Account[]> {
  const { data } = await supabase.from("accounts").select("*");
  return (data as Account[]) || [];
}

export async function saveAccount(uid: string, acc: Partial<Account>, id?: string) {
  if (id) {
    const { data: old } = await supabase.from("accounts").select("*").eq("id", id).single();
    if (old) {
      const diff = (acc.openingBalance ?? old.openingBalance ?? 0) - (old.openingBalance ?? 0);
      await supabase.from("accounts").update({ ...acc, balance: (old.balance || 0) + diff }).eq("id", id);
    }
    return id;
  } else {
    const ob = acc.openingBalance || 0;
    const { data } = await supabase.from("accounts").insert({ ...acc, balance: ob, openingBalance: ob }).select().single();
    return data.id;
  }
}

export async function deleteAccount(uid: string, id: string) {
  await supabase.from("accounts").delete().eq("id", id);
}

export async function listParties(uid: string): Promise<Party[]> {
  const { data } = await supabase.from("parties").select("*").order("name");
  return (data as Party[]) || [];
}

export async function saveParty(uid: string, party: Partial<Party>, id?: string) {
  if (id) {
    const { data: old } = await supabase.from("parties").select("*").eq("id", id).single();
    if (old) {
      const newOb = party.openingBalance ?? old.openingBalance ?? 0;
      const diff = newOb - (old.openingBalance ?? 0);
      await supabase.from("parties").update({ ...party, currentBalance: (old.currentBalance || 0) + diff }).eq("id", id);
    }
    return id;
  } else {
    const ob = party.openingBalance || 0;
    const { data } = await supabase.from("parties").insert({ ...party, currentBalance: ob, openingBalance: ob, customRates: {}, lastOrderDate: "", chase: false }).select().single();
    return data.id;
  }
}

export async function deleteParty(uid: string, id: string) {
  await supabase.from("parties").delete().eq("id", id);
}

export async function listItems(uid: string): Promise<Item[]> {
  const { data } = await supabase.from("items").select("*").order("name");
  return (data as Item[]) || [];
}

export async function saveItem(uid: string, item: Omit<Item, "id">, id?: string) {
  if (id) {
    await supabase.from("items").update(item).eq("id", id);
    return id;
  } else {
    const { data } = await supabase.from("items").insert(item).select().single();
    return data.id;
  }
}

export async function deleteItem(uid: string, id: string) {
  await supabase.from("items").delete().eq("id", id);
}

export async function saveBill(uid: string, bill: Omit<Bill, "id"> & { id?: string }, id?: string) {
  const billId = id || bill.id;
  let shouldPost = false;
  
  if (!bill.isPosted && (bill.deliveryStatus === "delivered" || bill.deliveryStatus === null)) {
    shouldPost = true;
  }

  if (bill.partyId) {
    const { data: p } = await supabase.from("parties").select("*").eq("id", bill.partyId).single();
    if (p) {
      const updatedRates = p.customRates || {};
      bill.lines.forEach((l: any) => { updatedRates[l.itemId] = l.rate; });
      const updates: Partial<Party> = { customRates: updatedRates };
      
      if (shouldPost && bill.saleType === "credit_delivery") {
        updates.currentBalance = (p.currentBalance || 0) + bill.total;
        updates.lastOrderDate = bill.date;
      }
      await supabase.from("parties").update(updates).eq("id", bill.partyId);
    }
  }

  if (shouldPost && bill.accountId && (bill.saleType === "walkin" || bill.saleType === "prepaid_delivery")) {
    const { data: a } = await supabase.from("accounts").select("*").eq("id", bill.accountId).single();
    if (a) {
      await supabase.from("accounts").update({ balance: (a.balance || 0) + bill.total }).eq("id", bill.accountId);
    }
  }

  if (shouldPost) bill.isPosted = true;

  let savedId = billId;
  if (billId) {
    await supabase.from("bills").update(bill).eq("id", billId);
  } else {
    const { data } = await supabase.from("bills").insert(bill).select().single();
    savedId = data.id;
  }

  // TELEGRAM LOGIC (Option 2): Trigger alert only when a credit delivery order is marked as delivered
  if (shouldPost && bill.saleType === "credit_delivery") {
    const itemsStr = bill.lines.map((l: any) => `${l.itemName} (${l.kg}kg)`).join(", ");
    let balStr = "";
    if (bill.partyId) {
      const { data: updatedParty } = await supabase.from("parties").select("currentBalance").eq("id", bill.partyId).single();
      const bal = updatedParty?.currentBalance || 0;
      balStr = `\n⚖️ New Balance: ${bal > 0 ? bal + " Dr" : Math.abs(bal) + " Cr"}`;
    }
    const msg = `📝 *Credit Sale Delivered & Posted*\n👤 Customer: ${bill.customerName}\n📦 Items: ${itemsStr}\n💰 Bill Amount: ₹${bill.total}${balStr}`;
    await sendTelegramNotification(msg);
  }

  return savedId;
}

export async function revertBill(uid: string, id: string) {
  const { data: old } = await supabase.from("bills").select("*").eq("id", id).single();
  if (!old) return;

  if (old.isPosted) {
    if (old.accountId && (old.saleType === "walkin" || old.saleType === "prepaid_delivery")) {
      const { data: aSnap } = await supabase.from("accounts").select("*").eq("id", old.accountId).single();
      if (aSnap) {
        await supabase.from("accounts").update({ balance: (aSnap.balance || 0) - old.total }).eq("id", old.accountId);
      }
    }
    if (old.partyId && old.saleType === "credit_delivery") {
      const { data: pSnap } = await supabase.from("parties").select("*").eq("id", old.partyId).single();
      if (pSnap) {
        await supabase.from("parties").update({ currentBalance: (pSnap.currentBalance || 0) - old.total }).eq("id", old.partyId);
      }
    }
  }
  await supabase.from("bills").delete().eq("id", id);
}

export async function cancelBill(uid: string, billId: string) {
  await supabase.from("bills").update({ deliveryStatus: "canceled" }).eq("id", billId);
}

export async function savePurchase(uid: string, purchase: Omit<Purchase, "id">, id?: string) {
  let purId = id;
  if (id) {
    await supabase.from("purchases").update(purchase).eq("id", id);
  } else {
    const { data } = await supabase.from("purchases").insert(purchase).select().single();
    purId = data.id;
  }

  if (purchase.accountId) {
    const { data: a } = await supabase.from("accounts").select("*").eq("id", purchase.accountId).single();
    if (a) {
      await supabase.from("accounts").update({ balance: (a.balance || 0) - purchase.total }).eq("id", purchase.accountId);
    }
  } else if (purchase.partyId) {
    const { data: p } = await supabase.from("parties").select("*").eq("id", purchase.partyId).single();
    if (p) {
      await supabase.from("parties").update({ currentBalance: (p.currentBalance || 0) - purchase.total }).eq("id", purchase.partyId);
    }
  }
  return purId;
}

export async function revertPurchase(uid: string, id: string) {
  const { data: old } = await supabase.from("purchases").select("*").eq("id", id).single();
  if (!old) return;

  if (old.accountId) {
    const { data: aSnap } = await supabase.from("accounts").select("*").eq("id", old.accountId).single();
    if (aSnap) {
      await supabase.from("accounts").update({ balance: (aSnap.balance || 0) + old.total }).eq("id", old.accountId);
    }
  } else if (old.partyId) {
    const { data: pSnap } = await supabase.from("parties").select("*").eq("id", old.partyId).single();
    if (pSnap) {
      await supabase.from("parties").update({ currentBalance: (pSnap.currentBalance || 0) + old.total }).eq("id", old.partyId);
    }
  }
  await supabase.from("purchases").delete().eq("id", id);
}

export async function saveMoney(uid: string, entry: Omit<MoneyEntry, "id">, id?: string) {
  let moneyId = id;
  if (id) {
    await supabase.from("money").update(entry).eq("id", id);
  } else {
    const { data } = await supabase.from("money").insert(entry).select().single();
    moneyId = data.id;
  }

  if (entry.type === "pdc_in" && entry.status === "pending") {
    return moneyId;
  }

  if (entry.accountId) {
    const { data: a } = await supabase.from("accounts").select("*").eq("id", entry.accountId).single();
    if (a) {
      const delta = (entry.type === "payment_in" || entry.type === "pdc_in") ? entry.amount : -entry.amount;
      await supabase.from("accounts").update({ balance: (a.balance || 0) + delta }).eq("id", entry.accountId);
    }
  }

  if (entry.partyId) {
    const { data: p } = await supabase.from("parties").select("*").eq("id", entry.partyId).single();
    if (p) {
      const delta = (entry.type === "payment_in" || entry.type === "pdc_in") ? -entry.amount : entry.amount;
      await supabase.from("parties").update({ currentBalance: (p.currentBalance || 0) + delta }).eq("id", entry.partyId);
    }
  }
  
  // TELEGRAM LOGIC: Trigger alert for Ledger Payments with live balance
  if (entry.partyId && (entry.type === "payment_in" || entry.type === "payment_out")) {
    const actionStr = entry.type === "payment_in" ? "Received from" : "Paid to";
    const icon = entry.type === "payment_in" ? "🟢" : "🔴";
    const { data: updatedParty } = await supabase.from("parties").select("currentBalance").eq("id", entry.partyId).single();
    const bal = updatedParty?.currentBalance || 0;
    const balStr = bal > 0 ? `${bal} Dr` : `${Math.abs(bal)} Cr`;

    const msg = `${icon} *Ledger Payment*\n👤 Party: ${entry.partyName}\n💸 Amount ${actionStr}: ₹${entry.amount}\n⚖️ Updated Balance: ${balStr}`;
    await sendTelegramNotification(msg);
  }

  return moneyId;
}

export async function revertMoney(uid: string, id: string) {
  const { data: old } = await supabase.from("money").select("*").eq("id", id).single();
  if (!old) return;

  if (old.accountId) {
    const { data: aSnap } = await supabase.from("accounts").select("*").eq("id", old.accountId).single();
    if (aSnap) {
      const delta = (old.type === "payment_in" || old.type === "pdc_in") ? -old.amount : old.amount;
      await supabase.from("accounts").update({ balance: (aSnap.balance || 0) + delta }).eq("id", old.accountId);
    }
  }
  if (old.partyId) {
    const { data: pSnap } = await supabase.from("parties").select("*").eq("id", old.partyId).single();
    if (pSnap) {
      const delta = (old.type === "payment_in" || old.type === "pdc_in") ? old.amount : -old.amount;
      await supabase.from("parties").update({ currentBalance: (pSnap.currentBalance || 0) + delta }).eq("id", old.partyId);
    }
  }
  await supabase.from("money").delete().eq("id", id);
}

export async function clearCheque(uid: string, entry: MoneyEntry, accountId: string) {
  if (!entry.id) return;

  await supabase.from("money").update({ status: "cleared", accountId }).eq("id", entry.id);

  const { data: a } = await supabase.from("accounts").select("*").eq("id", accountId).single();
  if (a) {
    await supabase.from("accounts").update({ balance: (a.balance || 0) + entry.amount }).eq("id", accountId);
  }

  if (entry.partyId) {
    const { data: p } = await supabase.from("parties").select("*").eq("id", entry.partyId).single();
    if (p) {
      await supabase.from("parties").update({ currentBalance: (p.currentBalance || 0) - entry.amount }).eq("id", entry.partyId);
    }
  }
}

export async function dashboard(uid: string) {
  const [partiesRes, billsRes, purRes, accRes, itemsRes, moneyRes] = await Promise.all([
    supabase.from("parties").select("*"),
    supabase.from("bills").select("*"),
    supabase.from("purchases").select("*"),
    supabase.from("accounts").select("*"),
    supabase.from("items").select("*"),
    supabase.from("money").select("*"),
  ]);

  const parties = (partiesRes.data as Party[]) || [];
  const bills = (billsRes.data as Bill[]) || [];
  const purchases = (purRes.data as Purchase[]) || [];
  const accounts = (accRes.data as Account[]) || [];
  const items = (itemsRes.data as Item[]) || [];
  const money = (moneyRes.data as MoneyEntry[]) || [];

  const stock = new Map<string, number>();
  const sold30Days = new Map<string, number>();
  
  items.forEach((i) => {
    stock.set(i.id, i.openingStock || 0); 
    sold30Days.set(i.id, 0);
  });

  purchases.forEach((p) => {
    stock.set(p.itemId, (stock.get(p.itemId) || 0) + p.kg);
  });

  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  bills.forEach((b) => {
    if (b.isPosted) {
      const bDate = new Date(b.date);
      b.lines.forEach((l) => {
        stock.set(l.itemId, (stock.get(l.itemId) || 0) - l.kg);
        if (bDate >= thirtyDaysAgo) {
          sold30Days.set(l.itemId, (sold30Days.get(l.itemId) || 0) + l.kg);
        }
      });
    }
  });

  const overdueParties: OverdueParty[] = [];
  const inactiveParties: InactiveParty[] = [];

  parties.forEach((p) => {
    if (p.kind === "customer" && p.currentBalance > 0 && p.lastOrderDate) {
      const orderDate = new Date(p.lastOrderDate);
      const diffDays = Math.floor((now.getTime() - orderDate.getTime()) / (1000 * 3600 * 24));
      const allowedDays = p.creditDays || 7;
      if (diffDays > allowedDays) {
        overdueParties.push({ party: p, overdueAmount: p.currentBalance, daysOverdue: diffDays - allowedDays });
      }
    }
    if (p.kind === "customer" && p.lastOrderDate) {
      const lastOrder = new Date(p.lastOrderDate);
      const diffDays = Math.floor((now.getTime() - lastOrder.getTime()) / (1000 * 3600 * 24));
      if (diffDays >= 7) {
        inactiveParties.push({ party: p, daysSinceLastOrder: diffDays });
      }
    }
  });

  const pendingCheques = money.filter(m => m.type === "pdc_in" && m.status === "pending" && m.clearanceDate && m.clearanceDate <= todayStr);

  const stockInsights: StockInsight[] = items.map((item) => {
    const currentKg = stock.get(item.id) || 0;
    const sold = sold30Days.get(item.id) || 0;
    let status: StockInsight["status"] = "healthy";
    if (currentKg <= 500) status = "low_stock";
    else if (sold === 0 && currentKg > 0) status = "dead_stock";

    return { itemId: item.id, itemName: item.name, currentKg, status, soldLast30DaysKg: sold };
  });

  return { parties, bills, purchases, accounts, items, money, overdueParties, inactiveParties, stockInsights, pendingCheques };
}

export async function factoryReset(uid: string) {
  const collections = ["parties", "bills", "purchases", "money", "accounts", "items"];
  for (const col of collections) {
    await supabase.from(col).delete().neq("id", "00000000-0000-0000-0000-000000000000");
  }
}