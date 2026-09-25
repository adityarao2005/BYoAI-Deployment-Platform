---
name: pet-store-inventory
description: Guidelines and procedures for searching, filtering, and checking the inventory and availability of pets in the store.
---
# Pet Store Inventory Management Skill

This skill provides step-by-step guidance on how to navigate the Petstore inventory and locate pets according to user inquiries.

## Available Statuses
Pets in the store have one of three statuses:
- `available`: Pets ready for immediate purchase or adoption.
- `pending`: Pets that are undergoing health checks or adoption processing.
- `sold`: Pets that have already been adopted/sold.

## Finding Pets
When a user asks what pets are available or queries pets by status:
1. Call the `petstore_findPetsByStatus` tool.
   - Pass `status: ["available"]` (or the requested status array).
2. When presenting pets to the user:
   - Always mention the pet's `id`, `name`, and category (if present).
   - If tags or photoUrls exist, summarize them cleanly.
   - Limit initial display to a reasonable list (e.g., top 5-10 pets) if many are returned, and offer to show more.

## Checking Overall Store Inventory
When a user asks how many pets or supplies the store currently holds:
1. Call `petstore_getInventory`.
2. Format the response into a readable summary table or list displaying the counts for each status.

## Finding a Specific Pet
When a user asks for details about a pet by ID:
1. Call `petstore_getPetById` passing the integer `petId`.
2. If found, present the pet's name, status, category, and photo links.
3. If the API returns a 404 / Pet not found, inform the user politely and offer to search available pets instead.
