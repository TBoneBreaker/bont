import { Plus, Trash2 } from 'lucide-react'
import { Card, IconButton } from '../../components/ui'
import type { FoodEntry, MealSlot } from '../../types'
import { sumFood } from './nutrition-utils'

export function MealList({
  meals,
  entries,
  onAdd,
  onRemove,
}: {
  meals: MealSlot[]
  entries: FoodEntry[]
  onAdd: (meal: MealSlot) => void
  onRemove: (entry: FoodEntry) => void
}) {
  return (
    <div className="stack">
      {meals.map((meal) => {
        const foods = entries.filter((entry) => entry.meal_slot_id === meal.id)
        const mealTotal = sumFood(foods)
        return (
          <Card key={meal.id} className="stack meal-card">
            <div className="card__row">
              <div>
                <h2>{meal.name}</h2>
                <span className="muted small">
                  {foods.length
                    ? `${Math.round(mealTotal.calories)} kcal · ${mealTotal.protein.toFixed(0)} g Eiweiß`
                    : 'Noch nichts eingetragen'}
                </span>
              </div>
              <IconButton label={`${meal.name}: Lebensmittel hinzufügen`} onClick={() => onAdd(meal)}>
                <Plus size={20} />
              </IconButton>
            </div>
            {foods.length > 0 && (
              <div className="food-list">
                {foods.map((food) => (
                  <div className="food-row" key={food.id}>
                    <div>
                      <strong>{food.name}</strong>
                      <span>
                        {food.brand ? `${food.brand} · ` : ''}
                        {food.amount} {food.unit === 'piece' ? 'Stück' : food.unit} · {Math.round(food.calories)} kcal
                      </span>
                    </div>
                    <IconButton label={`${food.name} entfernen`} onClick={() => onRemove(food)}>
                      <Trash2 size={16} />
                    </IconButton>
                  </div>
                ))}
              </div>
            )}
            <button className="add-row" onClick={() => onAdd(meal)}>
              <Plus size={17} /> Lebensmittel hinzufügen
            </button>
          </Card>
        )
      })}
    </div>
  )
}
