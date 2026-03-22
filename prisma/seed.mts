import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "bcryptjs";
import { createHash } from "crypto";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

async function main() {
  console.log("Seeding database...");

  // Clean existing data
  await prisma.energyReading.deleteMany();
  await prisma.command.deleteMany();
  await prisma.deviceState.deleteMany();
  await prisma.harvest.deleteMany();
  await prisma.scheduleEvent.deleteMany();
  await prisma.aIDecision.deleteMany();
  await prisma.photo.deleteMany();
  await prisma.sensorReading.deleteMany();
  await prisma.batch.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.zone.deleteMany();
  await prisma.farm.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.mLModel.deleteMany();

  // 1. Organization
  const org = await prisma.organization.create({
    data: {
      name: "Mushu Mushrooms",
      slug: "mushu-mushrooms",
      plan: "PRO",
    },
  });
  console.log("Created organization:", org.name);

  // 2. Users
  const passwordHash = await hash("password123", 12);

  const owner = await prisma.user.create({
    data: {
      name: "Giancarlo Perez",
      email: "giancarlo@mushu.se",
      passwordHash,
      role: "OWNER",
      organizationId: org.id,
    },
  });

  await prisma.user.create({
    data: {
      name: "Anna Svensson",
      email: "anna@mushu.se",
      passwordHash,
      role: "OPERATOR",
      organizationId: org.id,
    },
  });

  await prisma.user.create({
    data: {
      name: "Erik Johansson",
      email: "erik@mushu.se",
      passwordHash,
      role: "VIEWER",
      organizationId: org.id,
    },
  });
  console.log("Created 3 users (password: password123)");

  // 3. Farm
  const farm = await prisma.farm.create({
    data: {
      name: "Stockholm Studio Farm",
      address: "Sveavägen 42, Stockholm",
      timezone: "Europe/Stockholm",
      organizationId: org.id,
      electricityPriceKrPerKwh: 1.50,
      defaultSubstrateCostPerBag: 15.0,
      defaultLaborCostPerBatch: 200.0,
      defaultMarketPrices: {
        oyster_blue: 150,
        oyster_pink: 160,
        oyster_yellow: 155,
        lions_mane: 250,
        shiitake: 180,
      },
    },
  });

  // 4. API Key (demo key: agv_demo1234567890abcdefghijklmnopqrstuvwxyz0123456789ab)
  const demoKey = "agv_demo1234567890abcdefghijklmnopqrstuvwxyz0123456789ab";
  await prisma.apiKey.create({
    data: {
      name: "Pi Agent - All Zones",
      keyHash: hashApiKey(demoKey),
      prefix: demoKey.slice(0, 8),
      organizationId: org.id,
      farmId: farm.id,
    },
  });
  console.log("Created API key:", demoKey);

  // 5. Zones
  const zoneA = await prisma.zone.create({
    data: {
      name: "Zone A",
      farmId: farm.id,
      cameraType: "realsense_d435",
      agentStatus: "ONLINE",
      agentLastSeen: new Date(),
      currentPhase: "FRUITING",
      autoMode: true,
    },
  });

  const zoneB = await prisma.zone.create({
    data: {
      name: "Zone B",
      farmId: farm.id,
      cameraType: "realsense_d435",
      agentStatus: "ONLINE",
      agentLastSeen: new Date(Date.now() - 5 * 60 * 1000),
      currentPhase: "COLONIZATION",
      autoMode: true,
    },
  });

  const zoneC = await prisma.zone.create({
    data: {
      name: "Zone C",
      farmId: farm.id,
      cameraType: "wyze_cam",
      agentStatus: "OFFLINE",
      agentLastSeen: new Date(Date.now() - 3 * 60 * 60 * 1000),
      currentPhase: "IDLE",
      autoMode: false,
    },
  });
  console.log("Created 3 zones");

  // 6. Batches
  const now = new Date();

  // Active batch 1: Zone A, fruiting phase
  const batch1 = await prisma.batch.create({
    data: {
      batchNumber: "B-2026-007",
      zoneId: zoneA.id,
      cropType: "oyster_blue",
      substrate: "straw",
      bagCount: 12,
      substrateCost: 15.0,
      laborCost: 200.0,
      phase: "FRUITING",
      plantedAt: new Date(now.getTime() - 22 * 24 * 60 * 60 * 1000),
      fruitingAt: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000),
      estHarvestDate: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
      estYieldKg: 5.8,
      estProfit: 780,
      healthScore: 92,
    },
  });

  // Active batch 2: Zone B, colonization phase
  const batch2 = await prisma.batch.create({
    data: {
      batchNumber: "B-2026-008",
      zoneId: zoneB.id,
      cropType: "lions_mane",
      substrate: "sawdust",
      bagCount: 8,
      substrateCost: 15.0,
      laborCost: 200.0,
      phase: "COLONIZATION",
      plantedAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
      estHarvestDate: new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000),
      estYieldKg: 3.2,
      estProfit: 640,
      healthScore: 88,
    },
  });

  // Completed batch 1
  const batch3 = await prisma.batch.create({
    data: {
      batchNumber: "B-2026-005",
      zoneId: zoneA.id,
      cropType: "oyster_blue",
      substrate: "straw",
      bagCount: 12,
      phase: "HARVESTED",
      plantedAt: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000),
      fruitingAt: new Date(now.getTime() - 46 * 24 * 60 * 60 * 1000),
      harvestedAt: new Date(now.getTime() - 32 * 24 * 60 * 60 * 1000),
      actualYieldKg: 6.1,
      actualRevenue: 915,
      actualCost: 185,
      actualProfit: 730,
      qualityGrade: "A",
      healthScore: 95,
    },
  });

  // Completed batch 2
  const batch4 = await prisma.batch.create({
    data: {
      batchNumber: "B-2026-006",
      zoneId: zoneB.id,
      cropType: "shiitake",
      substrate: "sawdust",
      bagCount: 10,
      phase: "HARVESTED",
      plantedAt: new Date(now.getTime() - 55 * 24 * 60 * 60 * 1000),
      fruitingAt: new Date(now.getTime() - 38 * 24 * 60 * 60 * 1000),
      harvestedAt: new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000),
      actualYieldKg: 4.5,
      actualRevenue: 810,
      actualCost: 210,
      actualProfit: 600,
      qualityGrade: "A",
      healthScore: 89,
    },
  });

  // Planned batch
  await prisma.batch.create({
    data: {
      batchNumber: "B-2026-009",
      zoneId: zoneC.id,
      cropType: "oyster_pink",
      substrate: "straw",
      bagCount: 15,
      phase: "PLANNED",
      estHarvestDate: new Date(now.getTime() + 35 * 24 * 60 * 60 * 1000),
      estYieldKg: 7.2,
      estProfit: 960,
      notes: "New pink oyster variety, testing market demand",
    },
  });
  console.log("Created 5 batches");

  // 7. Sensor readings - 48 hours of data for zones A and B
  const sensorData = [];
  for (let hoursAgo = 48; hoursAgo >= 0; hoursAgo--) {
    const ts = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);
    // Zone A - fruiting conditions
    sensorData.push({
      zoneId: zoneA.id,
      temperature: 17.5 + Math.sin(hoursAgo / 6) * 1.5 + (Math.random() - 0.5),
      humidity: 88 + Math.sin(hoursAgo / 4) * 4 + (Math.random() - 0.5) * 2,
      co2: Math.round(650 + Math.sin(hoursAgo / 3) * 150 + (Math.random() - 0.5) * 50),
      vpd: 0.4 + Math.sin(hoursAgo / 6) * 0.15 + (Math.random() - 0.5) * 0.05,
      timestamp: ts,
    });
    // Zone B - colonization conditions
    sensorData.push({
      zoneId: zoneB.id,
      temperature: 19 + Math.sin(hoursAgo / 6) * 1 + (Math.random() - 0.5),
      humidity: 82 + Math.sin(hoursAgo / 4) * 3 + (Math.random() - 0.5) * 2,
      co2: Math.round(700 + Math.sin(hoursAgo / 3) * 100 + (Math.random() - 0.5) * 30),
      vpd: 0.55 + Math.sin(hoursAgo / 6) * 0.1 + (Math.random() - 0.5) * 0.05,
      timestamp: ts,
    });
  }
  await prisma.sensorReading.createMany({ data: sensorData });
  console.log(`Created ${sensorData.length} sensor readings`);

  // 8. Photos
  const photoData = [];
  for (let i = 0; i < 5; i++) {
    photoData.push({
      zoneId: zoneA.id,
      rgbUrl: `https://placehold.co/1280x720/111916/4abe7b?text=Zone+A+Photo+${i + 1}`,
      depthUrl: `https://placehold.co/1280x720/111916/3b82f6?text=Depth+${i + 1}`,
      analysis: {
        mushroom_count: 8 + i * 2,
        pin_count: Math.max(0, 5 - i),
        avg_diameter_cm: 3.5 + i * 0.8,
        coverage_percent: 55 + i * 6,
        contamination_risk: 0.02,
        estimated_weight_g: 200 + i * 45,
        growth_rate_cm3_day: 1.2 + i * 0.15,
      },
      timestamp: new Date(now.getTime() - (4 - i) * 6 * 60 * 60 * 1000),
    });
  }
  await prisma.photo.createMany({ data: photoData });
  console.log("Created 5 photos");

  // 9. AI Decisions
  const decisions = [
    {
      batchId: batch1.id,
      decisionType: "ENVIRONMENT" as const,
      decision: "MIST_NOW",
      reasoning: "Humidity dropped to 83%. Target is 85-90% for fruiting phase. Activating humidifier for 15 minutes.",
      actionTaken: "Humidifier activated for 15 min",
      sensorContext: { temp: 17.8, humidity: 83, co2: 720 },
      costKr: 0.25,
      timestamp: new Date(now.getTime() - 4 * 60 * 60 * 1000),
    },
    {
      batchId: batch1.id,
      decisionType: "HARVEST" as const,
      decision: "WAIT_2_DAYS",
      reasoning: "Current weight 380g at A-grade. Projected +18g/day for 2 more days = 416g still A-grade. Revenue increase 5.4 kr vs additional cost 1.3 kr. Net gain +4.1 kr per bag. Recommend harvest March 22.",
      actionTaken: null,
      mlContext: { weight_g: 380, growth_rate: 1.8, quality: "A" },
      costKr: 0.25,
      timestamp: new Date(now.getTime() - 8 * 60 * 60 * 1000),
    },
    {
      batchId: batch1.id,
      decisionType: "VISION" as const,
      decision: "GROWTH_ON_TRACK",
      reasoning: "12 mature mushrooms, 3 pins developing. Average diameter 6.2 cm. Coverage 78.5%. No contamination detected. Growth rate 1.8 cm³/day is above average.",
      actionTaken: null,
      mlContext: { mushroom_count: 12, pin_count: 3, avg_diameter_cm: 6.2, contamination_risk: 0.02 },
      costKr: 0.25,
      timestamp: new Date(now.getTime() - 12 * 60 * 60 * 1000),
    },
    {
      batchId: batch2.id,
      decisionType: "ENVIRONMENT" as const,
      decision: "MAINTAIN",
      reasoning: "Colonization conditions optimal. Temperature 19.2°C, humidity 82%. Mycelium growth progressing normally. No intervention needed.",
      actionTaken: null,
      sensorContext: { temp: 19.2, humidity: 82, co2: 710 },
      costKr: 0.25,
      timestamp: new Date(now.getTime() - 6 * 60 * 60 * 1000),
    },
    {
      batchId: batch1.id,
      decisionType: "STRATEGIC" as const,
      decision: "DAILY_OK",
      reasoning: "Daily strategic review: B-2026-007 on track for March 22 harvest. Current yield estimate 5.8 kg at A-grade. Profit projection 780 kr. Zone A running efficiently at 0.027 kr/gram. AI cost today: 0.75 kr (3 calls).",
      actionTaken: null,
      costKr: 0.25,
      timestamp: new Date(now.getTime() - 16 * 60 * 60 * 1000),
    },
    {
      batchId: batch1.id,
      decisionType: "ALERT" as const,
      decision: "CO2_SPIKE",
      reasoning: "CO2 reached 1150 ppm, above 1000 ppm threshold. Triggering fresh air cycle. Fan activated for 5 minutes. This is the 2nd spike in 24h — consider increasing base ventilation frequency.",
      actionTaken: "Fan activated for 5 min. Next fresh air cycle moved up by 10 min.",
      sensorContext: { temp: 18.1, humidity: 89, co2: 1150 },
      costKr: 0.25,
      timestamp: new Date(now.getTime() - 20 * 60 * 60 * 1000),
    },
    {
      batchId: batch3.id,
      decisionType: "HARVEST" as const,
      decision: "HARVEST_NOW",
      reasoning: "Weight stabilized at ~510g/bag. Quality still A-grade but growth rate dropped to 0.3 cm³/day. Further waiting risks B-grade (moisture weight gain without cap development). Harvesting now maximizes revenue.",
      actionTaken: "Harvest scheduled for tomorrow morning",
      mlContext: { weight_g: 510, growth_rate: 0.3, quality: "A", harvest_readiness: 0.96 },
      costKr: 0.25,
      timestamp: new Date(now.getTime() - 32 * 24 * 60 * 60 * 1000),
    },
    {
      batchId: batch1.id,
      decisionType: "ENVIRONMENT" as const,
      decision: "FAN_CYCLE",
      reasoning: "Scheduled fresh air cycle. CO2 at 880 ppm, within range but approaching threshold. Running preventive 3-minute fan cycle.",
      actionTaken: "Fan activated for 3 min",
      sensorContext: { temp: 17.6, humidity: 87, co2: 880 },
      costKr: 0.25,
      timestamp: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    },
    {
      batchId: batch4.id,
      decisionType: "STRATEGIC" as const,
      decision: "BATCH_REVIEW",
      reasoning: "B-2026-006 (Shiitake) completed: 4.5 kg yield, 810 kr revenue, 210 kr cost, 600 kr profit. Cost per gram: 0.047 kr. 17% below oyster efficiency but shiitake commands higher price. Recommend maintaining shiitake in rotation.",
      actionTaken: null,
      costKr: 0.25,
      timestamp: new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000),
    },
    {
      batchId: batch1.id,
      decisionType: "ENVIRONMENT" as const,
      decision: "LIGHT_CYCLE",
      reasoning: "Starting 12h light cycle for fruiting. Light on at 06:00, off at 18:00. Indirect light supports primordia formation.",
      actionTaken: "Light schedule set: 06:00-18:00",
      costKr: 0.25,
      timestamp: new Date(now.getTime() - 1 * 60 * 60 * 1000),
    },
  ];
  await prisma.aIDecision.createMany({ data: decisions });
  console.log("Created 10 AI decisions");

  // 10. Harvests for completed batches
  await prisma.harvest.create({
    data: {
      batchId: batch3.id,
      weightKg: 6.1,
      qualityGrade: "A",
      pricePerKg: 150,
      revenue: 915,
      energyCost: 65,
      substrateCost: 48,
      laborCost: 72,
      totalCost: 185,
      profit: 730,
      costPerGram: 0.030,
      harvestedAt: new Date(now.getTime() - 32 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.harvest.create({
    data: {
      batchId: batch4.id,
      weightKg: 4.5,
      qualityGrade: "A",
      pricePerKg: 180,
      revenue: 810,
      energyCost: 78,
      substrateCost: 55,
      laborCost: 77,
      totalCost: 210,
      profit: 600,
      costPerGram: 0.047,
      harvestedAt: new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000),
    },
  });
  console.log("Created 2 harvests");

  // 11. Device states (with scope)
  const deviceStates = [
    // Farm-wide humidifier
    { farmId: farm.id, zoneId: null, scope: "FARM" as const, deviceType: "HUMIDIFIER" as const, deviceName: "Main Humidifier", state: true, lastToggled: new Date(now.getTime() - 15 * 60 * 1000) },
    // Zone-specific devices
    { farmId: farm.id, zoneId: zoneA.id, scope: "ZONE" as const, deviceType: "FAN" as const, deviceName: "Exhaust Fan", state: false, lastToggled: new Date(now.getTime() - 45 * 60 * 1000) },
    { farmId: farm.id, zoneId: zoneA.id, scope: "ZONE" as const, deviceType: "LIGHT" as const, deviceName: "Grow Light", state: true, lastToggled: new Date(now.getTime() - 2 * 60 * 60 * 1000) },
    { farmId: farm.id, zoneId: zoneB.id, scope: "ZONE" as const, deviceType: "FAN" as const, deviceName: "Exhaust Fan", state: false, lastToggled: new Date(now.getTime() - 2 * 60 * 60 * 1000) },
    { farmId: farm.id, zoneId: zoneB.id, scope: "ZONE" as const, deviceType: "LIGHT" as const, deviceName: "Grow Light", state: false, lastToggled: new Date(now.getTime() - 3 * 60 * 60 * 1000) },
  ];
  await prisma.deviceState.createMany({ data: deviceStates });
  console.log("Created 5 device states (1 farm-wide, 4 zone)");

  // 11b. Energy readings (sample data)
  const energyReadings = [];
  for (let daysAgo = 20; daysAgo >= 0; daysAgo--) {
    const ts = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    // Farm-wide humidifier
    energyReadings.push({
      farmId: farm.id,
      zoneId: null,
      deviceName: "Main Humidifier",
      kWh: 0.8 + Math.random() * 0.4,
      costKr: (0.8 + Math.random() * 0.4) * 1.5,
      timestamp: ts,
    });
    // Zone A light
    energyReadings.push({
      farmId: farm.id,
      zoneId: zoneA.id,
      deviceName: "Grow Light",
      kWh: 0.5 + Math.random() * 0.2,
      costKr: (0.5 + Math.random() * 0.2) * 1.5,
      timestamp: ts,
    });
    // Zone A fan
    energyReadings.push({
      farmId: farm.id,
      zoneId: zoneA.id,
      deviceName: "Exhaust Fan",
      kWh: 0.15 + Math.random() * 0.1,
      costKr: (0.15 + Math.random() * 0.1) * 1.5,
      timestamp: ts,
    });
  }
  await prisma.energyReading.createMany({ data: energyReadings });
  console.log(`Created ${energyReadings.length} energy readings`);

  // 12. Schedule events
  const scheduleEvents = [
    {
      batchId: batch1.id,
      eventType: "HARVEST_WINDOW" as const,
      title: "B-007 Harvest Window",
      description: "Optimal harvest window for Blue Oyster batch. AI confidence: 91%.",
      scheduledAt: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
      status: "PENDING" as const,
    },
    {
      batchId: batch1.id,
      eventType: "VISION_CHECK" as const,
      title: "B-007 Pre-Harvest Vision Check",
      description: "Final ML vision check before harvest to confirm quality grade.",
      scheduledAt: new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000),
      status: "PENDING" as const,
    },
    {
      batchId: batch2.id,
      eventType: "PHASE_CHANGE" as const,
      title: "B-008 Expected Fruiting Start",
      description: "Lion's Mane colonization should be complete. Visual confirmation needed.",
      scheduledAt: new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000),
      status: "PENDING" as const,
    },
    {
      eventType: "DELIVERY" as const,
      title: "Restaurant Norra Delivery",
      description: "5 kg Blue Oyster to Restaurant Norra. Contact: chef@norra.se",
      scheduledAt: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
      status: "PENDING" as const,
    },
    {
      eventType: "MAINTENANCE" as const,
      title: "Sensor Calibration",
      description: "Monthly ESP32 sensor calibration for all zones.",
      scheduledAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      status: "PENDING" as const,
    },
    {
      batchId: batch3.id,
      eventType: "HARVEST_WINDOW" as const,
      title: "B-005 Harvest (Completed)",
      description: "Harvested 6.1 kg Blue Oyster. Grade A.",
      scheduledAt: new Date(now.getTime() - 32 * 24 * 60 * 60 * 1000),
      completedAt: new Date(now.getTime() - 32 * 24 * 60 * 60 * 1000),
      status: "COMPLETED" as const,
    },
  ];
  await prisma.scheduleEvent.createMany({ data: scheduleEvents });
  console.log("Created 6 schedule events");

  // 13. ML Models
  await prisma.mLModel.createMany({
    data: [
      {
        name: "contamination_detector",
        version: "1.0.0",
        cropType: "all",
        fileUrl: "https://models.agrivision.ai/contamination_v1.onnx",
        fileSizeMb: 12.4,
        accuracy: 0.94,
        trainedOn: "ImageNet + 2400 mushroom photos",
        epochs: 25,
        isActive: true,
      },
      {
        name: "growth_stage_classifier",
        version: "1.2.0",
        cropType: "oyster",
        fileUrl: "https://models.agrivision.ai/growth_stage_v1.2.onnx",
        fileSizeMb: 8.7,
        accuracy: 0.91,
        trainedOn: "ImageNet + 3100 oyster growth photos",
        epochs: 30,
        isActive: true,
      },
      {
        name: "weight_predictor",
        version: "1.1.0",
        cropType: "oyster",
        fileUrl: "https://models.agrivision.ai/weight_pred_v1.1.onnx",
        fileSizeMb: 15.2,
        accuracy: 0.87,
        trainedOn: "ImageNet + 1800 oyster photos with weight labels",
        epochs: 40,
        isActive: true,
      },
    ],
  });
  console.log("Created 3 ML models");

  // 14. A pending command
  await prisma.command.create({
    data: {
      zoneId: zoneA.id,
      command: "FORCE_MIST",
      payload: { duration_seconds: 300 },
      status: "PENDING",
    },
  });
  console.log("Created 1 pending command");

  console.log("\nSeed complete!");
  console.log("Login with: giancarlo@mushu.se / password123");
  console.log(`API Key: ${demoKey}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
