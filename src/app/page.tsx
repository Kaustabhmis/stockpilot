import InventoryClient from '@/components/inventory-client';

export default function Home() {
  return (
    <div className="min-h-screen bg-background p-4 md:p-6 font-body">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6">
          <h1 className="text-3xl font-bold text-foreground mb-1 font-headline">StockPilot</h1>
          <p className="text-muted-foreground">BOM-Driven Inventory with Sales Integration & Forecasting</p>
        </header>
        <main>
          <InventoryClient />
        </main>
      </div>
    </div>
  );
}
