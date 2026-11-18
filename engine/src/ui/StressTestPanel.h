#pragma once

#include <QWidget>

#include <memory>

class QLabel;
class QListWidget;
class AudioManager;

class StressTestPanel : public QWidget {
	Q_OBJECT

public:
	explicit StressTestPanel(QWidget* parent = nullptr);
	~StressTestPanel() override;

private:

};