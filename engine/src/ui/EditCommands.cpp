/*!************************************************************************
\file EditCommands.cpp
\brief
Implements the undoable editor commands declared in EditCommands.h.
**************************************************************************/
#include "ui/EditCommands.h"

#include "splat/CropBox.h"
#include "splat/SplatModel.h"
#include "splat/SplatRenderer.h"

MoveModelCommand::MoveModelCommand(SplatModel* model, const glm::mat4& before, const glm::mat4& after, QUndoCommand* parent) 
    : QUndoCommand(parent), m_model(model), m_before(before), m_after(after)
{
    //Shown in the Edit menu as "Undo Move <name>".
    setText(QString("Move %1").arg(QString::fromStdString(model->GetName())));
}


LoadModelCommand::LoadModelCommand(SplatModel* model, const std::string& before, const std::string& after, QUndoCommand* parent)
{
    //Left blank for now
}

void MoveModelCommand::undo() {
    m_model->SetTransform(m_before);
}

void MoveModelCommand::redo() {
    m_model->SetTransform(m_after);
}

RenameModelCommand::RenameModelCommand(SplatModel* model, const std::string& before, const std::string& after, QUndoCommand* parent)
    : QUndoCommand(parent), m_model(model), m_before(before), m_after(after)
{
    //Shown in the Edit menu as "Undo Rename <old name>".
    setText(QString("Rename %1").arg(QString::fromStdString(before)));
}

void RenameModelCommand::undo() {
    m_model->SetName(m_before);
}

void RenameModelCommand::redo() {
    m_model->SetName(m_after);
}

MoveCropBoxCommand::MoveCropBoxCommand(CropBox* box, const glm::mat4& before, const glm::mat4& after, QUndoCommand* parent)
    : QUndoCommand(parent), m_box(box), m_before(before), m_after(after)
{
    setText("Move Crop Box");
}

void MoveCropBoxCommand::undo() {
    QUndoCommand::undo(); //Undoes any child commands (the splats carried along with the box)
    m_box->transform = m_before;
}

void MoveCropBoxCommand::redo() {
    m_box->transform = m_after;
    QUndoCommand::redo(); //Redoes any child commands
}

RemoveSplatsCommand::RemoveSplatsCommand(SplatRenderer* renderer, SplatModel* model, const std::vector<uint8_t>& keepMask, QUndoCommand* parent)
    : QUndoCommand(parent), m_renderer(renderer), m_model(model)
{
    const std::vector<SplatVertex>& splats = model->splats();
    if (keepMask.size() == splats.size()) {
        for (size_t i = 0; i < splats.size(); ++i) {
            if (!keepMask[i]) {
                m_indices.push_back(static_cast<uint32_t>(i));
                m_removed.push_back(splats[i]);
            }
        }
    }
    setText(QString("Remove %1 Splats").arg(m_removed.size()));
}

void RemoveSplatsCommand::redo() {
    const std::vector<SplatVertex>& current = m_model->splats();
    std::vector<SplatVertex> kept;
    kept.reserve(current.size() - m_removed.size());

    size_t next = 0; //Next entry of m_indices still to skip
    for (size_t i = 0; i < current.size(); ++i) {
        if (next < m_indices.size() && m_indices[next] == i) {
            ++next;
            continue;
        }
        kept.push_back(current[i]);
    }
    m_renderer->ClearSelection(); //Its indices refer to the old list
    m_renderer->UpdateModel(m_model, kept);
}

void RemoveSplatsCommand::undo() {
    const std::vector<SplatVertex>& current = m_model->splats();
    std::vector<SplatVertex> restored;
    restored.reserve(current.size() + m_removed.size());

    size_t next = 0; //Next removed splat to put back
    size_t cur = 0;  //Next current splat to copy
    const size_t total = current.size() + m_removed.size();
    for (size_t i = 0; i < total; ++i) {
        if (next < m_indices.size() && m_indices[next] == i) {
            restored.push_back(m_removed[next++]);
        }
        else if (cur < current.size()) {
            restored.push_back(current[cur++]);
        }
    }
    m_renderer->ClearSelection(); //Its indices refer to the old list
    m_renderer->UpdateModel(m_model, restored);
}

MoveSplatsCommand::MoveSplatsCommand(SplatRenderer* renderer, SplatModel* model, const std::vector<uint32_t>& indices,
                                     const glm::mat4& deltaModel, QUndoCommand* parent)
    : QUndoCommand(parent), m_renderer(renderer), m_model(model), m_indices(indices)
{
    const std::vector<SplatVertex>& splats = model->splats();
    m_before.reserve(indices.size());
    m_after.reserve(indices.size());
    for (uint32_t index : indices) {
        m_before.push_back(splats[index]);
        m_after.push_back(TransformSplat(splats[index], deltaModel));
    }
    setText(QString("Move %1 Splats").arg(indices.size()));
}

void MoveSplatsCommand::Write(const std::vector<SplatVertex>& values) {
    std::vector<SplatVertex> splats = m_model->splats();
    //The splat list changed under us, don't index out of range
    if (!m_indices.empty() && m_indices.back() >= splats.size()) return;
    for (size_t i = 0; i < m_indices.size(); ++i) {
        splats[m_indices[i]] = values[i];
    }
    m_renderer->UpdateModel(m_model, splats);
}

void MoveSplatsCommand::undo() {
    Write(m_before);
}

void MoveSplatsCommand::redo() {
    Write(m_after);
}
