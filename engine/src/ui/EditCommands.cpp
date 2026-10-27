/*!************************************************************************
\file EditCommands.cpp
\brief
Implements the undoable editor commands declared in EditCommands.h.
**************************************************************************/
#include "ui/EditCommands.h"

#include "splat/SplatModel.h"

MoveModelCommand::MoveModelCommand(SplatModel* model, const glm::mat4& before, const glm::mat4& after,
                                   QUndoCommand* parent)
    : QUndoCommand(parent), m_model(model), m_before(before), m_after(after) {
    // Shown in the Edit menu as "Undo Move <name>".
    setText(QString("Move %1").arg(QString::fromStdString(model->GetName())));
}

void MoveModelCommand::undo() {
    m_model->SetTransform(m_before);
}

void MoveModelCommand::redo() {
    m_model->SetTransform(m_after);
}
